import { InfrastructureError, retryInfrastructure } from '../../contracts/infrastructure'
import { assignedJev, parseJevRequest, parseJevResult } from '../../contracts/jev'
import type { JevRequest, JevEvaluation } from '../../contracts/jev'
import { MailWorkflow } from '../mail/workflow'
import { createWorkflowMailTransport } from '../mail/workflow-transport'
import type { WorkflowDefinition } from '../../contracts/workflows'
import { workflowInput, publishWorkflowOutput } from '../workflows/handoff'
import { maxAgentTimeoutSeconds, parseAgentRequest } from '../../contracts/agent'
import { DependencyStore } from '../dependencies/store'
import { assignedDirectories } from '../../runtime/directories'
import { podDirectories } from '../../runtime/environment'
import { parseHttpRequest } from '../../contracts/http'
import type { HttpRequest, HttpReply } from '../../contracts/http'
import { assignedHttp } from '../../main/programs/http-service'
import { EffectLedger } from '../recovery/effects'
import { executeHttpEffect } from './http'
import { PodVariables } from '../resources/variables'
import { parseCredentialRead } from '../../contracts/credentials'
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
import { graphEmitter, parseGraphContract } from '../../contracts/graphs'
import type { GraphEmit } from '../../contracts/graphs'
import { graphRun, pendingItems, settleItems } from '../workflows/items'
import type { DeliveredItem } from '../workflows/items'
import { gateCoverage, gateRound } from '../workflows/gates'
import { installExample } from './examples'
import type { NetworkInvocations } from '../scheduling/network-invocations'
import type { NetworkAuthority, NetworkEmission } from '../scheduling/network-events'
import { canonicalNetworkJson } from '../scheduling/network-events'
import { fenceNetworkBoot } from '../scheduling/network-boot'

interface NetworkExecution { invocations: NetworkInvocations, authority: NetworkAuthority, emissions: NetworkEmission[] }

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
  mailArchive?: (body: unknown, signal: AbortSignal, scope: RunServiceScope) => Promise<unknown>
  gate?: (body: unknown, signal: AbortSignal, scope: RunServiceScope) => Promise<unknown>
  jev?: (request: JevRequest, signal: AbortSignal, scope: RunServiceScope) => Promise<JevEvaluation>
  shell?: (scope: RunServiceScope, signal: AbortSignal) => Promise<{ home: string, environment: Record<string, string>, shell?: { cli: string, environment: Record<string, string> } }>
  closeShell?: (scope: RunServiceScope) => Promise<void>
  http?: (request: HttpRequest, signal: AbortSignal, scope: RunServiceScope) => Promise<HttpReply>
  credential?: (alias: string, signal: AbortSignal, scope: RunServiceScope) => Promise<string>
  provider?: AgentGatewayServices['provider']
  tool?: (body: unknown, signal: AbortSignal, scope: RunServiceScope) => Promise<unknown>
}

function archiveTarget(payload: unknown): { operation: 'process', target: unknown } {
  const request = payload as { operation?: unknown, target?: unknown } | null
  if (!request || typeof request !== 'object' || request.operation !== 'process' || Object.keys(request).some(key => !['operation', 'target'].includes(key))) throw new Error('Channel graphs archive only through an approval gate')
  return { operation: 'process', target: request.target }
}

const maxAgentPauseMs = 2 * maxAgentTimeoutSeconds * 1000

export class RunDispatcher {
  readonly runs: RunStore
  private active = new Map<string, { controller: AbortController, work: Promise<void> }>()
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry, private readonly runtime: AgentRuntime, private readonly services?: RunServices) {
    this.runs = new RunStore(store)
    store.transaction(() => {
      fenceNetworkBoot(store)
      store.db.prepare('UPDATE runs SET state=\'interrupted\',error=\'Previous worker stopped; explicit recovery is required\',checkpoint_revision=(SELECT revision FROM checkpoints WHERE pod_id=runs.pod_id) WHERE state=\'running\' AND id IN (SELECT run_id FROM run_leases)').run()
      store.db.prepare('UPDATE run_leases SET boot_id=?').run(`fenced:${this.runs.bootId}`)
      store.db.prepare('UPDATE effect_ledger SET state=\'unknown\' WHERE state=\'intent\'').run()
    })
  }

  view(podId: string, id?: string, after = 0): RunView {
    const runs = this.runs.list(podId)
    if (id && !runs.some(run => run.id === id)) {
      const selected = this.runs.get(id)
      if (selected.podId !== podId) throw new Error('Run belongs to another Pod')
      if (runs.length === 100) runs.pop()
      runs.unshift(selected)
    }
    const selectedId = id ?? runs[0]?.id
    const effects = this.store.db.prepare('SELECT effect_key AS key,run_id AS runId FROM effect_ledger WHERE pod_id=? AND operation=\'http.request\' AND state=\'unknown\' LIMIT 100').all(podId) as { key: string, runId: string }[]
    return { ...(selectedId ? { timing: this.runs.timing(podId, selectedId) } : {}), approvals: this.runs.approvals(podId), effects, runs, events: selectedId ? (after ? this.runs.events(podId, selectedId, after) : this.runs.recentEvents(podId, selectedId)) : [] }
  }

  async install(podId: string, variant: 'deterministic' | 'agent'): Promise<void> {
    const manifest = JSON.parse(await readFile(this.runtime.manifest, 'utf8')) as { dependencyLockHash: string }
    installExample(this.store, this.resources, podId, variant, manifest.dependencyLockHash)
  }

  start(podId: string, trigger: RunTrigger = { reason: 'manual', eventIds: [] }, accepted?: (runId: string) => void): string {
    if (this.store.db.prepare('SELECT 1 FROM network_members WHERE pod_id=?').get(podId)) throw new Error('Network instances require network intake and dispatch')
    this.store.assertStorage()
    if (this.store.db.prepare('SELECT 1 FROM effect_ledger WHERE pod_id=? AND state IN (\'intent\',\'unknown\')').get(podId)) throw new Error('An HTTP delivery needs review before this pod can run again')
    const pod = this.store.getPod(podId)
    if (!pod.activeScript) throw new Error('Choose and validate a script before running this pod')
    const epoch = this.resources.epoch(podId)
    const reservation = this.store.transaction(() => {
      const reserved = this.runs.reserve(podId, pod.activeScript!, epoch, trigger)
      accepted?.(reserved.run.id)
      return reserved
    })
    if (reservation.existing) return reservation.run.id
    const controller = new AbortController()
    const work = this.execute(reservation.run.id, epoch, controller.signal, trigger)
    this.active.set(podId, { controller, work })
    return reservation.run.id
  }

  cancelPod(podId: string, message = 'Run cancelled by the owner'): void { this.active.get(podId)?.controller.abort(new Error(message)) }

  startNetwork(invocations: NetworkInvocations, authority: NetworkAuthority): void {
    this.store.assertStorage()
    const { row, member } = invocations.events.authority(authority)
    this.runs.assertLease(authority.runId)
    if (this.active.has(member.podId)) throw new Error('Network instance already has an active process')
    const manifest = JSON.parse(row.manifest as string) as { reason: RunTrigger['reason'], resourceEpoch: number }
    const controller = new AbortController()
    const execution = { invocations, authority, emissions: [] }
    const work = this.execute(authority.runId, manifest.resourceEpoch, controller.signal, { reason: manifest.reason, eventIds: [] }, execution).catch(async (failure: unknown) => {
      try { await invocations.failClosed(authority, failure) }
      catch (cleanupFailure) {
        try {
          this.store.db.prepare('INSERT INTO network_trace_events(network_id,run_id,kind,body,created_at) VALUES(?,?,?,?,?)').run(row.network_id!, authority.runId, 'settlement-cleanup-unverified', JSON.stringify({ reason: (cleanupFailure instanceof Error ? cleanupFailure.message : 'Network cleanup failed').slice(0, 10000), explicitInspectionRequired: true }), Date.now())
        }
        catch { console.error('Network cleanup diagnostic could not be persisted; its retained state requires inspection') }
        console.error('Network settlement cleanup failed; explicit inspection is required')
      }
    }).finally(() => { this.active.delete(member.podId) })
    this.active.set(member.podId, { controller, work })
  }

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

  private async execute(id: string, epoch: number, signal: AbortSignal, trigger: RunTrigger, network?: NetworkExecution): Promise<void> {
    const run = this.runs.get(id); const pod = this.store.getPod(run.podId)
    const assertCurrent = () => { this.runs.assertLease(id); network?.invocations.events.authority(network.authority); this.resources.assertCurrent(pod.id, epoch); if (this.store.getPod(pod.id).bindingRevision !== pod.bindingRevision) throw new Error('Script binding changed during the run'); signal.throwIfAborted() }
    const appendEvent = (type: string, data: unknown) => {
      if (!network) { this.runs.append(id, type, data); return }
      const networkId = network.invocations.events.authority(network.authority).definition.id
      const body = canonicalNetworkJson({ data })
      if (Buffer.byteLength(body) > 256 * 1024) throw new Error('Network trace exceeds its size limit')
      this.store.db.prepare('INSERT INTO network_trace_events(network_id,run_id,kind,body,created_at) VALUES(?,?,?,?,?)').run(networkId, id, type, body, Date.now())
    }
    const directory = join(this.store.root, 'runs', id)
    const pendingAgents = new Set<Promise<unknown>>()
    // Agent calls carry their own bounded timeout, so they pause the script budget,
    // up to a per-run total so unawaited calls cannot extend a run indefinitely.
    let activeAgentCalls = 0; let agentPausedMs = 0; let agentSince = 0
    const agentBudgetPaused = () => activeAgentCalls > 0 && agentPausedMs + (Date.now() - agentSince) < maxAgentPauseMs
    let shellScope: RunServiceScope | undefined
    let infrastructureWaiting = 0
    let scriptStarted = false
    const graph = graphRun(this.store, id); let delivered: DeliveredItem[] = []; const emits: (GraphEmit & { channel: string })[] = []
    const settle = (completed: boolean) => { if (graph) settleItems(this.store, graph, completed && this.runs.get(id).state === 'completed', delivered, emits, Date.now()) }
    const retryService = async <T>(operation: string, work: () => Promise<T>, signal: AbortSignal, budgetMs?: number) => {
      let waiting = false
      try {
        return await retryInfrastructure(async () => {
          assertCurrent()
          if (waiting && ((pod.lifecycle === 'active' && this.store.getPod(pod.id).lifecycle !== 'active') || this.store.db.prepare('SELECT 1 FROM workflow_attempts a JOIN workflow_runs w ON w.id=a.workflow_run_id WHERE a.run_id=? AND w.paused=1').get(id))) {
            this.cancelPod(pod.id, 'Infrastructure retry cancelled because the owner paused execution')
            signal.throwIfAborted()
          }
          return work()
        }, signal, (retry) => {
          if (retry && !waiting) { waiting = true; infrastructureWaiting++ }
          appendEvent('infrastructure', { operation, ...(retry ?? { state: 'restored' }) })
        }, budgetMs)
      }
      finally { if (waiting) infrastructureWaiting-- }
    }
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const manifestRow = this.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(pod.id, run.scriptHash)
      if (!manifestRow) throw new Error('Pinned script is missing')
      const manifest = parseManifest(JSON.parse(manifestRow.manifest as string))
      if (network && manifest.capabilities.length) throw new Error('Network capabilities require declared runtime ports')
      if (!manifest.triggers.includes(trigger.reason)) throw new Error('Script does not allow this trigger')
      const assigned = this.resources.list(pod.id).filter(resource => resource.kind === 'tool' && resource.state === 'ready').map(resource => resource.configuration.capability)
      if (manifest.capabilities.filter(capability => !capability.startsWith('credential.')).some(capability => !assigned.includes(capability)) || (manifest.capabilities.includes('mail.read') && !this.services?.tool)) throw new Error('No tool assignments are available for this script')
      const artifact = join(directory, 'run.mjs'); await writeFile(artifact, this.store.readBlob(run.scriptHash), { flag: 'wx', mode: 0o400 })
      const snapshots = network
        ? await this.resources.capture(pod.id, this.runtime.helper, { runId: id, assertCurrent })
        : await this.resources.capture(pod.id, this.runtime.helper)
      assertCurrent()
      const networkInput = network?.invocations.input(network.authority)
      const checkpoint = networkInput?.checkpoint ?? this.store.checkpoint(pod.id)
      const folders = await podDirectories(this.store.root, pod.id)
      const directories = await assignedDirectories(this.store.root, pod.id, this.resources.list(pod.id))
      assertCurrent()
      const input: RunInput = { workflow: workflowInput(this.store, id), home: folders.home, directories: directories.map(({ path, access }) => ({ path, access })), variables: { ...Object.fromEntries((graph?.definition.values ?? []).map(value => [value.name, value.value])), ...new PodVariables(this.store).values(pod.id) }, version: 1, runId: id, podId: pod.id, scriptHash: run.scriptHash, assignmentRevision: pod.bindingRevision, reason: trigger.reason, eventIds: trigger.eventIds, checkpointRevision: checkpoint.revision, checkpoint: checkpoint.body, resourceEpoch: epoch, workspace: folders.workspace, references: snapshots.files.map(file => ({ id: file.id, hash: file.hash, path: file.content })), limits: { timeMs: 300000, frameBytes: 256 * 1024 } }
      if (networkInput) { input.network = networkInput.network; input.eventIds = networkInput.items.map(item => item.eventId) }
      appendEvent('snapshot', { id: snapshots.id, files: input.references })
      const dependencies = new DependencyStore(this.store); const dependencyHash = dependencies.scriptSet(pod.id, run.scriptHash)
      const dependencyRoot = dependencyHash ? await dependencies.verify(pod.id, dependencyHash) : undefined
      const runtime = { ...this.runtime, dependencyRoot, registerDomain: (path: string, ownerPid: number) => this.runs.registerDomain(id, path, ownerPid) }
      const scope: RunServiceScope = { podId: pod.id, runId: id, epoch, assignmentRevision: pod.bindingRevision, capabilities: manifest.capabilities, root: directory, assertCurrent, registerDomain: runtime.registerDomain }
      const invokeTool = async (body: unknown, toolSignal: AbortSignal) => {
        assertCurrent()
        if (!manifest.capabilities.some(capability => capability === 'mail.read' || capability.startsWith('tool.app_') || capability.startsWith('tool.ssh_')) || !this.services?.tool) throw new Error('No tool capability is assigned to this pod')
        const operation = retryService('tool authorization', async () => { assertCurrent(); return this.services!.tool!(body, toolSignal, scope) }, toolSignal)
        pendingAgents.add(operation)
        try { const reply = await operation; assertCurrent(); return reply }
        finally { pendingAgents.delete(operation) }
      }
      if (this.services?.shell && !network) {
        const environment = await retryService('runtime authorization', () => this.services!.shell!(scope, signal), signal, 30000)
        Object.assign(runtime, { home: environment.home, shell: environment.shell, environment: { ...environment.environment, ...runtime.environment } })
        shellScope = scope
      }
      const contract = manifest.contract === undefined ? undefined : parseGraphContract(manifest.contract)
      const checkEmit = graphEmitter(contract)
      let mailWorkflow: MailWorkflow | undefined
      let mail: MailRecipeSession | undefined
      appendEvent('environment', { script: artifact, workspace: input.workspace, values: Object.fromEntries(Object.entries(runtime.environment).filter(([key]) => ['HOME', 'TMPDIR', 'PATH', 'SHELL', 'PODS_POD_ID', 'LANG', 'TERM'].includes(key))) })
      const result = await executeScript(runtime, directory, artifact, input, signal, {
        budgetPaused: () => infrastructureWaiting > 0 || agentBudgetPaused() || this.runs.approvals(pod.id).some(item => item.runId === id),
        event: (type, data) => { assertCurrent(); appendEvent(type, data); if (type === 'process') scriptStarted = true; if (type === 'process') this.store.db.prepare('UPDATE run_leases SET process_id=? WHERE run_id=?').run((data as { pid: number }).pid, id) },
        request: async (operation, payload, operationSignal) => {
          assertCurrent()
          if (network) {
            if (!['graph.contract', 'graph.emit', 'network.emit', 'progress.commit'].includes(operation)) throw new Error('Network operation requires a declared runtime port')
            if (operation === 'progress.commit') return network.invocations.stageProgress(network.authority, payload)
            if (operation === 'graph.contract') {
              const pinned = network.invocations.events.authority(network.authority).member.contract
              if (!contract || canonicalNetworkJson(parseGraphContract(payload)) !== canonicalNetworkJson(pinned) || canonicalNetworkJson(contract) !== canonicalNetworkJson(pinned)) throw new Error('Network script contract differs from its pinned definition')
              return network.invocations.input(network.authority).items
            }
            if (network.emissions.length >= 500) throw new Error('Network invocation exceeds 500 emissions')
            if (operation === 'graph.emit') {
              if (input.network!.source) throw new Error('Network sources must emit explicit source item versions')
              const emit = checkEmit(payload)
              network.emissions.push(network.invocations.events.emission(network.authority, { channel: emit.channel, key: emit.key, payload: emit.data }))
              if (emit.reason !== undefined || emit.confidence !== undefined) appendEvent('emission-explanation', { channel: emit.channel, key: emit.key, reason: emit.reason ?? null, confidence: emit.confidence ?? null })
              return { staged: true }
            }
            network.emissions.push(network.invocations.events.emission(network.authority, payload))
            return { staged: true }
          }
          if (operation === 'network.emit') throw new Error('Network emission requires a network invocation')
          if (operation === 'mail.archive') {
            if (!this.services?.mailArchive) throw new Error('Mail archive service is unavailable')
            // In a graph the script never names what may move; the consumed gate batches do.
            const request = graph ? { ...archiveTarget(payload), gate: gateCoverage(this.store, graph, delivered) } : payload
            const work = this.services.mailArchive(request, operationSignal, scope)
            pendingAgents.add(work)
            try { const result = await work; assertCurrent(); return result }
            finally { pendingAgents.delete(work) }
          }
          if (operation.startsWith('mail.workflow.')) {
            const attempt = this.store.db.prepare('SELECT w.definition,w.id FROM workflow_attempts a JOIN workflow_runs w ON w.id=a.workflow_run_id WHERE a.run_id=?').get(id)
            const configuration = attempt ? (JSON.parse(attempt.definition as string) as WorkflowDefinition).mail : null
            if (!configuration || ![configuration.filterPodId, configuration.notifyPodId].includes(pod.id)) throw new Error('Mail integration is not assigned to this workflow node')
            if (!mailWorkflow) {
              mailWorkflow = new MailWorkflow(this.store, attempt!.id as string, pod.id, id, configuration, createWorkflowMailTransport(configuration, {
                assertCurrent,
                tool: body => invokeTool(body, signal),
                credential: async (alias) => {
                  if (!this.services?.credential) throw new Error('Script credential service is unavailable')
                  new ScriptCredentials(this.store, this.resources).readable(pod.id, alias)
                  return this.services.credential(alias, operationSignal, scope)
                },
                http: async (request) => {
                  if (!this.services?.http) throw new Error('HTTP service is unavailable')
                  assignedHttp(this.resources.list(pod.id), scope, request)
                  return this.services.http(request, operationSignal, scope)
                },
              }))
            }
            const request = payload as { offset?: number, summary?: string }
            if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some(key => !['offset', 'summary'].includes(key))) throw new Error('Invalid mail workflow request')
            if (operation === 'mail.workflow.remaining') return mailWorkflow.remaining(request.offset)
            const work = operation === 'mail.workflow.filter' ? mailWorkflow.filter() : mailWorkflow.notify(request.summary!)
            pendingAgents.add(work)
            try { return await work }
            finally { pendingAgents.delete(work) }
          }
          if (operation === 'graph.contract') {
            if (!contract || JSON.stringify(parseGraphContract(payload)) !== JSON.stringify(contract)) throw new Error('Script contract changed since validation')
            if (!graph) return []
            await gateRound(this.store, graph, async (body) => {
              if (!this.services?.gate) throw new Error('Approval service is unavailable')
              return retryService('approval', async () => { assertCurrent(); return this.services!.gate!(body, operationSignal, scope) }, operationSignal)
            })
            assertCurrent()
            delivered = pendingItems(this.store, graph.workflowId, graph.node)
            return delivered.map(({ key, channel, data }) => ({ key, channel, data }))
          }
          if (operation === 'graph.emit') {
            const emit = checkEmit(payload)
            // Emits become items only when the run completes, so a failed run hands nothing on.
            emits.push(emit)
            appendEvent('emit', { channel: emit.channel, key: emit.key }); return { emitted: true }
          }
          if (operation === 'workflow.publish') { publishWorkflowOutput(this.store, id, payload); return { published: true } }
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
              appendEvent('checkpoint', { revision: result.revision, kind: 'mail-knowledge', gaps: result.gapIds.length })
              return result
            }
            const result = await mail.next() as { type: string, hash?: string, sources?: number, omissions?: string[], revision?: number, count?: number }
            appendEvent('mail-progress', { type: result.type, contextHash: result.hash, sources: result.sources, omissions: result.omissions, revision: result.revision, retrieved: result.count })
            return result
          }
          if (operation === 'jev.evaluate') {
            const assignment = assignedJev(this.resources.list(pod.id), pod.id, scope.capabilities)
            if (!this.services?.jev) throw new Error('Jev service is unavailable')
            const request = parseJevRequest(payload)
            const started = Date.now()
            const pending = this.services.jev(request, operationSignal, scope)
            pendingAgents.add(pending)
            try {
              const evaluation = await pending
              assertCurrent(); operationSignal.throwIfAborted()
              const result = parseJevResult(evaluation.result, request, assignment.model)
              appendEvent('jev', { provider: 'typesafe', model: result.model, attempts: evaluation.attempts, durationMs: Date.now() - started, usage: result.usage })
              return result
            }
            finally { pendingAgents.delete(pending) }
          }
          if (operation === 'http.request') {
            if (!this.services?.http) throw new Error('HTTP service is unavailable')
            const request = parseHttpRequest(payload)
            assignedHttp(this.resources.list(pod.id), scope, request)
            const pending = executeHttpEffect(new EffectLedger(this.store), pod.id, id, request, async () => {
              const result = await retryService('HTTP request', async () => { assertCurrent(); return this.services!.http!(request, operationSignal, scope) }, operationSignal)
              assertCurrent(); operationSignal.throwIfAborted(); return result
            })
            pendingAgents.add(pending)
            try { return await pending }
            finally { pendingAgents.delete(pending) }
          }
          if (operation === 'progress.commit') {
            const progress = parseProgress(payload)
            const revision = this.store.commitProgress({ ...progress, podId: pod.id })
            appendEvent('checkpoint', { revision }); return { revision }
          }
          if (operation === 'credentials.get') {
            const alias = parseCredentialRead(payload)
            if (!this.services?.credential) throw new Error('Script credential service is unavailable')
            new ScriptCredentials(this.store, this.resources).readable(pod.id, alias)
            const request = this.services.credential(alias, operationSignal, scope); pendingAgents.add(request)
            try { const value = await request; assertCurrent(); operationSignal.throwIfAborted(); return value }
            finally { pendingAgents.delete(request) }
          }
          if (operation === 'agent.run') {
            if (!this.services?.provider) throw new Error('Codex is not connected; connect the pod provider before using this script')
            const request = parseAgentRequest(payload)
            const operation = executeAgent(runtime, directory, request.prompt, input.references.map(file => file.path), { provider: this.services.provider, tool: invokeTool }, operationSignal, (event) => { assertCurrent(); appendEvent('agent', event) }, request.tools, request.timeoutSeconds)
            pendingAgents.add(operation); if (activeAgentCalls++ === 0) agentSince = Date.now()
            try { return await operation }
            finally { pendingAgents.delete(operation); if (--activeAgentCalls === 0) agentPausedMs += Date.now() - agentSince }
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
      await this.finish(id, result.status, result.summary, result.status === 'failed' || result.status === 'blocked' ? result.summary : null, result.completedInputIds, undefined, () => settle(true), network)
    }
    catch (error) {
      if (network) network.invocations.recordConflict(network.authority, error)
      const message = (error instanceof Error ? error.message : 'Run failed').slice(0, 10000)
      await Promise.allSettled(pendingAgents)
      await this.finish(id, signal.aborted ? 'cancelled' : 'failed', signal.aborted ? 'Run cancelled' : 'Run failed', message, [], !signal.aborted && !scriptStarted && error instanceof InfrastructureError ? epoch : undefined, () => settle(false), network)
    }
    finally {
      try { if (shellScope) await this.services?.closeShell?.(shellScope) }
      catch (error) { appendEvent('diagnostic', { text: error instanceof Error ? error.message : 'Pod shell cleanup failed' }) }
      finally { if (!network) this.active.delete(pod.id) }
    }
  }

  private async finish(id: string, state: RunState, summary: string, error: string | null, completedInputIds: string[] = [], retryEpoch?: number, settle: () => void = () => {}, network?: NetworkExecution): Promise<void> {
    if (network) { await network.invocations.finish(network.authority, state, summary, error, completedInputIds, network.emissions); return }
    try { await confirmDomainsStopped(this.store, id, this.runtime.helper) }
    catch (failure) {
      this.runs.interrupt(id, failure instanceof Error ? failure.message : 'Execution cleanup is unverified')
      return
    }
    this.store.transaction(() => { this.runs.finish(id, state, summary, error, completedInputIds, retryEpoch); settle() })
  }

}
