import { confirmDomainsStopped } from '../recovery/domains'
import type { RunState, RunInput, RunView  } from '../../contracts/runs'
import type { RunTrigger } from './store'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PodDatabase } from '../storage/database'
import { parseManifest } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'
import { RunStore } from './store'
import { executeScript } from './runner'
import { executeAgent } from '../agent/executor'
import type { AgentRuntime } from '../agent/executor'
import type { AgentGatewayServices } from '../agent/gateway'
import { parseProgress } from './progress'
import { installExample } from './examples'

export class RunDispatcher {
  readonly runs: RunStore
  private active = new Map<string, { controller: AbortController, work: Promise<void> }>()
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry, private readonly runtime: AgentRuntime, private readonly services?: AgentGatewayServices) {
    this.runs = new RunStore(store)
    store.transaction(() => {
      store.db.prepare('UPDATE runs SET state=\'interrupted\',error=\'Previous worker stopped; explicit recovery is required\',checkpoint_revision=(SELECT revision FROM checkpoints WHERE pod_id=runs.pod_id) WHERE state=\'running\' AND id IN (SELECT run_id FROM run_leases)').run()
      store.db.prepare('UPDATE run_leases SET boot_id=?').run(`fenced:${this.runs.bootId}`)
      store.db.prepare('UPDATE effect_ledger SET state=\'unknown\' WHERE state=\'intent\'').run()
    })
  }

  view(podId: string, id?: string, after = 0): RunView { return { runs: this.runs.list(podId), events: id ? this.runs.events(podId, id, after) : [] } }

  async install(podId: string, variant: 'deterministic' | 'agent'): Promise<void> {
    const manifest = JSON.parse(await readFile(this.runtime.manifest, 'utf8')) as { dependencyLockHash: string }
    installExample(this.store, this.resources, podId, variant, manifest.dependencyLockHash)
  }

  start(podId: string, trigger: RunTrigger = { reason: 'manual', eventIds: [] }): string {
    const pod = this.store.getPod(podId)
    if (!pod.activeScript) throw new Error('Choose and validate a script before running this pod')
    const epoch = this.resources.epoch(podId)
    const reservation = this.runs.reserve(podId, pod.activeScript, epoch, trigger)
    if (reservation.existing) return reservation.run.id
    const controller = new AbortController()
    const work = this.execute(reservation.run.id, epoch, controller.signal, trigger)
    this.active.set(podId, { controller, work })
    return reservation.run.id
  }

  cancelPod(podId: string, message = 'Run cancelled by the owner'): void { this.active.get(podId)?.controller.abort(new Error(message)) }

  cancel(podId: string, id: string): void {
    if (this.runs.get(id).podId !== podId) throw new Error('Run belongs to a different pod')
    const lease = this.store.db.prepare('SELECT run_id FROM run_leases WHERE pod_id=?').get(podId)
    if (lease?.run_id !== id) throw new Error('Run is not active')
    this.cancelPod(podId)
  }

  async stop(): Promise<void> {
    const active = [...this.active.values()]
    for (const run of active) run.controller.abort(new Error('Application is quitting'))
    await Promise.all(active.map(run => run.work))
  }

  private async execute(id: string, epoch: number, signal: AbortSignal, trigger: RunTrigger): Promise<void> {
    const run = this.runs.get(id); const pod = this.store.getPod(run.podId)
    const assertCurrent = () => { this.runs.assertLease(id); this.resources.assertCurrent(pod.id, epoch); if (this.store.getPod(pod.id).revision !== pod.revision) throw new Error('Assignment changed during the run'); signal.throwIfAborted() }
    const directory = join(this.store.root, 'runs', id)
    const pendingAgents = new Set<Promise<unknown>>()
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const manifestRow = this.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(pod.id, run.scriptHash)
      if (!manifestRow) throw new Error('Pinned script is missing')
      const manifest = parseManifest(JSON.parse(manifestRow.manifest as string))
      if (!manifest.triggers.includes(trigger.reason)) throw new Error('Script does not allow this trigger')
      if (manifest.capabilities.length || manifest.effects !== 'readOnly') throw new Error('No tool assignments are available for this script')
      const artifact = join(directory, 'run.mjs'); await writeFile(artifact, this.store.readBlob(run.scriptHash), { flag: 'wx', mode: 0o400 })
      const snapshots = await this.resources.capture(pod.id, this.runtime.helper)
      assertCurrent()
      const checkpoint = this.store.checkpoint(pod.id)
      const input: RunInput = { version: 1, runId: id, podId: pod.id, scriptHash: run.scriptHash, assignmentRevision: pod.revision, reason: trigger.reason, eventIds: trigger.eventIds, checkpointRevision: checkpoint.revision, checkpoint: checkpoint.body, resourceEpoch: epoch, workspace: join(this.store.root, 'pods', pod.id, 'workspace'), references: snapshots.files.map(file => ({ id: file.id, hash: file.hash, path: file.content })), limits: { timeMs: 300000, frameBytes: 256 * 1024 } }
      this.runs.append(id, 'snapshot', { id: snapshots.id, files: input.references })
      const runtime = { ...this.runtime, registerDomain: (path: string, ownerPid: number) => this.runs.registerDomain(id, path, ownerPid) }
      const result = await executeScript(runtime, directory, artifact, input, signal, {
        event: (type, data) => { this.runs.assertLease(id); this.runs.append(id, type, data); if (type === 'process') this.store.db.prepare('UPDATE run_leases SET process_id=? WHERE run_id=?').run((data as { pid: number }).pid, id) },
        request: async (operation, payload, operationSignal) => {
          assertCurrent()
          if (operation === 'progress.commit') {
            const progress = parseProgress(payload)
            const revision = this.store.commitProgress({ ...progress, podId: pod.id })
            this.runs.append(id, 'checkpoint', { revision }); return { revision }
          }
          if (operation === 'agent.run') {
            if (!this.services) throw new Error('Codex is not connected; connect the pod provider before using this script')
            if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => key !== 'prompt') || typeof (payload as { prompt?: unknown }).prompt !== 'string') throw new Error('Invalid agent request')
            const operation = executeAgent(runtime, directory, (payload as { prompt: string }).prompt, input.references.map(file => file.path), { provider: this.services.provider, tool: async (body, toolSignal) => { assertCurrent(); return this.services!.tool(body, toolSignal) } }, operationSignal, (event) => { assertCurrent(); this.runs.append(id, 'agent', event) })
            pendingAgents.add(operation)
            try { return await operation }
            finally { pendingAgents.delete(operation) }
          }
          throw new Error('No tool capability is assigned to this pod')
        },
      })
      assertCurrent()
      for (const gap of result.gapIds) {
        if (!this.store.db.prepare('SELECT 1 FROM claims WHERE pod_id=? AND id=? AND kind=\'gap\'').get(pod.id, gap)) throw new Error('Result references an uncommitted gap')
      }
      await this.finish(id, result.status, result.summary, result.status === 'failed' || result.status === 'blocked' ? result.summary : null, result.completedInputIds)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Run failed'
      await Promise.allSettled(pendingAgents)
      await this.finish(id, signal.aborted ? 'cancelled' : 'failed', signal.aborted ? 'Run cancelled' : 'Run failed', message)
    }
    finally { this.active.delete(pod.id) }
  }

  private async finish(id: string, state: RunState, summary: string, error: string | null, completedInputIds: string[] = []): Promise<void> {
    try { await confirmDomainsStopped(this.store, id, this.runtime.helper) }
    catch (failure) {
      this.runs.interrupt(id, failure instanceof Error ? failure.message : 'Execution cleanup is unverified')
      return
    }
    this.runs.finish(id, state, summary, error, completedInputIds)
  }

}
