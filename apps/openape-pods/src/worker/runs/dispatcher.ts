import { parseHttpRequest } from '../../contracts/http'
import type { HttpRequest, HttpReply } from '../../contracts/http'
import { assignedHttp } from '../../main/programs/http-service'
import { EffectLedger } from '../recovery/effects'
import { executeHttpEffect } from './http'
import { PodVariables } from '../resources/variables'
import { credentialAliases, parseCredentialRead } from '../../contracts/credentials'
import { ScriptCredentials } from '../resources/script-credentials'
import { MailRecipeSession, mailToolRequest } from '../mail/recipe'
import { extractSource } from '../mail/extraction'
import { assignedMail } from '../../main/mail/assigned'
import type { MailPage } from '../mail/ingestion'
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

export interface RunServiceScope {
  podId: string
  runId: string
  epoch: number
  assignmentRevision: number
  capabilities: string[]
  root: string
  assertCurrent: () => void
  registerDomain: (path: string, ownerPid: number) => void
}
export interface RunServices {
  shell?: (scope: RunServiceScope, signal: AbortSignal) => Promise<{ home: string, environment: Record<string, string>, shell: { cli: string, environment: Record<string, string> } }>
  closeShell?: (scope: RunServiceScope) => Promise<void>
  http?: (request: HttpRequest, signal: AbortSignal, scope: RunServiceScope) => Promise<HttpReply>
  credential?: (alias: string, signal: AbortSignal, scope: RunServiceScope) => Promise<string>
  provider?: AgentGatewayServices['provider']
  tool?: (body: unknown, signal: AbortSignal, scope: RunServiceScope) => Promise<unknown>
}

export class RunDispatcher {
  readonly runs: RunStore
  private active = new Map<string, { controller: AbortController, work: Promise<void> }>()
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry, private readonly runtime: AgentRuntime, private readonly services?: RunServices) {
    this.runs = new RunStore(store)
    store.transaction(() => {
      store.db.prepare('UPDATE runs SET state=\'interrupted\',error=\'Previous worker stopped; explicit recovery is required\',checkpoint_revision=(SELECT revision FROM checkpoints WHERE pod_id=runs.pod_id) WHERE state=\'running\' AND id IN (SELECT run_id FROM run_leases)').run()
      store.db.prepare('UPDATE run_leases SET boot_id=?').run(`fenced:${this.runs.bootId}`)
      store.db.prepare('UPDATE effect_ledger SET state=\'unknown\' WHERE state=\'intent\'').run()
    })
  }

  view(podId: string, id?: string, after = 0): RunView { return { effects: this.store.db.prepare('SELECT effect_key AS key,run_id AS runId FROM effect_ledger WHERE pod_id=? AND operation=\'http.request\' AND state=\'unknown\' LIMIT 100').all(podId) as { key: string, runId: string }[], runs: this.runs.list(podId), events: id ? this.runs.events(podId, id, after) : [] } }

  async install(podId: string, variant: 'deterministic' | 'agent'): Promise<void> {
    const manifest = JSON.parse(await readFile(this.runtime.manifest, 'utf8')) as { dependencyLockHash: string }
    installExample(this.store, this.resources, podId, variant, manifest.dependencyLockHash)
  }

  start(podId: string, trigger: RunTrigger = { reason: 'manual', eventIds: [] }): string {
    this.store.assertStorage()
    if (this.store.db.prepare('SELECT 1 FROM effect_ledger WHERE pod_id=? AND state IN (\'intent\',\'unknown\')').get(podId)) throw new Error('An HTTP delivery needs review before this pod can run again')
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
    const assertCurrent = () => { this.runs.assertLease(id); this.resources.assertCurrent(pod.id, epoch); if (this.store.getPod(pod.id).bindingRevision !== pod.bindingRevision) throw new Error('Script binding changed during the run'); signal.throwIfAborted() }
    const directory = join(this.store.root, 'runs', id)
    const pendingAgents = new Set<Promise<unknown>>()
    let shellScope: RunServiceScope | undefined
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const manifestRow = this.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(pod.id, run.scriptHash)
      if (!manifestRow) throw new Error('Pinned script is missing')
      const manifest = parseManifest(JSON.parse(manifestRow.manifest as string))
      if (!manifest.triggers.includes(trigger.reason)) throw new Error('Script does not allow this trigger')
      const assigned = this.resources.list(pod.id).filter(resource => resource.kind === 'tool' && resource.state === 'ready').map(resource => resource.configuration.capability)
      if (manifest.capabilities.filter(capability => !capability.startsWith('credential.')).some(capability => !assigned.includes(capability)) || (manifest.capabilities.includes('mail.read') && !this.services?.tool)) throw new Error('No tool assignments are available for this script')
      new ScriptCredentials(this.store, this.resources).assertApproved(pod.id, run.scriptHash, manifest.capabilities)
      if (credentialAliases(manifest.capabilities).length && !this.services?.credential) throw new Error('Script credential service is unavailable')
      const artifact = join(directory, 'run.mjs'); await writeFile(artifact, this.store.readBlob(run.scriptHash), { flag: 'wx', mode: 0o400 })
      const snapshots = await this.resources.capture(pod.id, this.runtime.helper)
      assertCurrent()
      const checkpoint = this.store.checkpoint(pod.id)
      const input: RunInput = { variables: new PodVariables(this.store).values(pod.id), version: 1, runId: id, podId: pod.id, scriptHash: run.scriptHash, assignmentRevision: pod.bindingRevision, reason: trigger.reason, eventIds: trigger.eventIds, checkpointRevision: checkpoint.revision, checkpoint: checkpoint.body, resourceEpoch: epoch, workspace: join(this.store.root, 'pods', pod.id, 'workspace'), references: snapshots.files.map(file => ({ id: file.id, hash: file.hash, path: file.content })), limits: { timeMs: 300000, frameBytes: 256 * 1024 } }
      this.runs.append(id, 'snapshot', { id: snapshots.id, files: input.references })
      const runtime = { ...this.runtime, registerDomain: (path: string, ownerPid: number) => this.runs.registerDomain(id, path, ownerPid) }
      const scope: RunServiceScope = { podId: pod.id, runId: id, epoch, assignmentRevision: pod.bindingRevision, capabilities: manifest.capabilities, root: directory, assertCurrent, registerDomain: runtime.registerDomain }
      const invokeTool = async (body: unknown, toolSignal: AbortSignal) => {
        assertCurrent()
        if (!manifest.capabilities.some(capability => capability === 'mail.read' || capability.startsWith('tool.app_')) || !this.services?.tool) throw new Error('No tool capability is assigned to this pod')
        const operation = this.services.tool(body, toolSignal, scope)
        pendingAgents.add(operation)
        try { const reply = await operation; assertCurrent(); return reply }
        finally { pendingAgents.delete(operation) }
      }
      if (this.services?.shell) {
        const environment = await this.services.shell(scope, signal)
        Object.assign(runtime, { home: environment.home, shell: environment.shell, environment: { ...environment.environment, ...runtime.environment } })
        shellScope = scope
      }
      let mail: MailRecipeSession | undefined
      const result = await executeScript(runtime, directory, artifact, input, signal, {
        event: (type, data) => { this.runs.assertLease(id); this.runs.append(id, type, data); if (type === 'process') this.store.db.prepare('UPDATE run_leases SET process_id=? WHERE run_id=?').run((data as { pid: number }).pid, id) },
        request: async (operation, payload, operationSignal) => {
          assertCurrent()
          if (operation === 'mail.next' || operation === 'mail.commit') {
            if (!manifest.capabilities.includes('mail.read')) throw new Error('Mail recipe permission is not assigned')
            if (!mail) {
              const assignment = assignedMail(this.resources.list(pod.id)).mail
              mail = new MailRecipeSession(this.store, pod.id, assignment, async request => await invokeTool(mailToolRequest(assignment, request), operationSignal) as MailPage, async (source) => {
                const extraction = extractSource(runtime, directory, source, operationSignal, runtime.registerDomain)
                pendingAgents.add(extraction)
                try { return await extraction }
                finally { pendingAgents.delete(extraction) }
              }, assertCurrent, run.scriptHash)
            }
            if (operation === 'mail.commit') {
              const result = mail.commit(payload)
              this.runs.append(id, 'checkpoint', { revision: result.revision, kind: 'mail-knowledge', gaps: result.gapIds.length })
              return result
            }
            const result = await mail.next() as { type: string, hash?: string, sources?: number, omissions?: string[], revision?: number, count?: number }
            this.runs.append(id, 'mail-progress', { type: result.type, contextHash: result.hash, sources: result.sources, omissions: result.omissions, revision: result.revision, retrieved: result.count })
            return result
          }
          if (operation === 'http.request') {
            if (!this.services?.http) throw new Error('HTTP service is unavailable')
            const request = parseHttpRequest(payload)
            assignedHttp(this.resources.list(pod.id), scope, request)
            const pending = executeHttpEffect(new EffectLedger(this.store), pod.id, id, request, async () => {
              const result = await this.services!.http!(request, operationSignal, scope)
              assertCurrent(); operationSignal.throwIfAborted(); return result
            })
            pendingAgents.add(pending)
            try { return await pending }
            finally { pendingAgents.delete(pending) }
          }
          if (operation === 'progress.commit') {
            const progress = parseProgress(payload)
            const revision = this.store.commitProgress({ ...progress, podId: pod.id })
            this.runs.append(id, 'checkpoint', { revision }); return { revision }
          }
          if (operation === 'credentials.get') {
            const alias = parseCredentialRead(payload)
            if (!manifest.capabilities.includes(`credential.${alias}`) || !this.services?.credential) throw new Error('Credential capability is not declared by this script')
            new ScriptCredentials(this.store, this.resources).assertApproved(pod.id, run.scriptHash, manifest.capabilities)
            const request = this.services.credential(alias, operationSignal, scope); pendingAgents.add(request)
            try { const value = await request; assertCurrent(); operationSignal.throwIfAborted(); return value }
            finally { pendingAgents.delete(request) }
          }
          if (operation === 'agent.run') {
            if (!this.services?.provider) throw new Error('Codex is not connected; connect the pod provider before using this script')
            if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => key !== 'prompt') || typeof (payload as { prompt?: unknown }).prompt !== 'string') throw new Error('Invalid agent request')
            const operation = executeAgent(runtime, directory, (payload as { prompt: string }).prompt, input.references.map(file => file.path), { provider: this.services.provider, tool: invokeTool }, operationSignal, (event) => { assertCurrent(); this.runs.append(id, 'agent', event) })
            pendingAgents.add(operation)
            try { return await operation }
            finally { pendingAgents.delete(operation) }
          }
          if (operation === 'tools.invoke') return invokeTool(payload, operationSignal)
          throw new Error('Unsupported script operation')
        },
      })
      assertCurrent()
      if (this.store.db.prepare('SELECT 1 FROM effect_ledger WHERE run_id=? AND state IN (\'intent\',\'unknown\')').get(id)) throw new Error('An HTTP delivery needs review before this pod can run again')
      for (const gap of result.gapIds) {
        if (!this.store.db.prepare('SELECT 1 FROM claims WHERE pod_id=? AND id=? AND kind=\'gap\'').get(pod.id, gap)) throw new Error('Result references an uncommitted gap')
      }
      if (shellScope) { await this.services?.closeShell?.(shellScope); shellScope = undefined }
      await this.finish(id, result.status, result.summary, result.status === 'failed' || result.status === 'blocked' ? result.summary : null, result.completedInputIds)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Run failed'
      await Promise.allSettled(pendingAgents)
      await this.finish(id, signal.aborted ? 'cancelled' : 'failed', signal.aborted ? 'Run cancelled' : 'Run failed', message)
    }
    finally {
      try { if (shellScope) await this.services?.closeShell?.(shellScope) }
      catch (error) { this.runs.append(id, 'diagnostic', { text: error instanceof Error ? error.message : 'Pod shell cleanup failed' }) }
      finally { this.active.delete(pod.id) }
    }
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
