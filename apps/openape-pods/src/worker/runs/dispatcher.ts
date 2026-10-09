import { InboxOutbox, parseNotify } from '../inbox/outbox'
import { RunCancellation, unresolvedOperation } from '../recovery/policy'
import type { RecoveryFailure } from '../recovery/policy'
import { programRequest } from '../../main/programs/invoke'
import { supportedNetworkCapability, networkArchiveMember } from '../../contracts/network-capabilities'
import { archiveApproved, parseArchiveTarget } from '../scheduling/network-archive'
import type { NetworkGateCoverage } from '../../contracts/network-gates'
import { boundedStep } from '../scheduling/tick-step'
import type { NetworkGates, NetworkGateStep, NetworkGateService } from '../scheduling/network-gates'
import { AuthorityError, InfrastructureError, NonRetryableError, retryInfrastructure } from '../../contracts/infrastructure'
import { assignedJev, parseJevRequest, parseJevResult } from '../../contracts/jev'
import type { JevRequest, JevEvaluation } from '../../contracts/jev'
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
import { parseMailRequest } from '../../main/mail/contract'
import { assignedMail } from '../../main/mail/assigned'
import type { MailPage } from '../mail/ingestion'
import { confirmDomainsStopped } from '../recovery/domains'
import { runAliases } from '../../contracts/runs'
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
import { installExample } from './examples'
import type { NetworkInvocations } from '../scheduling/network-invocations'
import type { NetworkAuthority, NetworkEmission } from '../scheduling/network-events'
import { canonicalNetworkJson } from '../scheduling/network-events'
import { assertNetworkQuota } from '../scheduling/network-quota'
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
  mailMove?: (body: unknown, signal: AbortSignal, scope: RunServiceScope) => Promise<unknown>
}

const maxAgentPauseMs = 2 * maxAgentTimeoutSeconds * 1000
const maxAgentCallsPerRun = 50

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
    if (unresolvedOperation(this.store, podId)) throw new Error('An operation without replay evidence requires review')
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

  cancelPod(podId: string, message = 'Run cancelled by the owner', cause: RecoveryFailure['cause'] = 'owner-cancelled'): void { this.active.get(podId)?.controller.abort(new RunCancellation(cause, message)) }

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

  startGate(gates: NetworkGates, step: NetworkGateStep): void {
    const { manifest } = gates.assertStep(step)
    if (this.active.has(manifest.podId)) throw new Error('Network gate instance already has an active execution')
    const controller = new AbortController()
    // Run services authorize against the pinned script's declared capabilities, also for a gate step that launches no script.
    const pinned = this.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(manifest.podId, manifest.scriptHash)
    if (!pinned) throw new Error('Pinned service script is missing')
    const capabilities = parseManifest(JSON.parse(pinned.manifest as string)).capabilities
    const scope: RunServiceScope = { podId: manifest.podId, runId: step.authority.runId, epoch: manifest.resourceEpoch, assignmentRevision: manifest.assignmentRevision, capabilities, root: join(this.store.root, 'runs', step.authority.runId), assertCurrent: () => { gates.assertStep(step); controller.signal.throwIfAborted() }, registerDomain: (path, ownerPid) => this.runs.registerDomain(step.authority.runId, path, ownerPid) }
    const service: NetworkGateService = async (body) => {
      scope.assertCurrent()
      if (!this.services?.gate) throw new Error('Network gate service is unavailable')
      const deadline = Number(this.store.db.prepare('SELECT deadline FROM network_invocation_controls WHERE run_id=?').get(step.authority.runId)!.deadline)
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new InfrastructureError({ phase: 'read', retryAfterMs: 5000 })
      const reply = await boundedStep(remaining, async () => { const value = await this.services!.gate!(body, controller.signal, scope); if (body.operation === 'create') gates.observeCreation(step, value); scope.assertCurrent(); return value }, () => controller.abort(new InfrastructureError({ phase: 'read', retryAfterMs: 5000 })))
      if (reply === undefined) { controller.signal.throwIfAborted(); throw new Error('Network gate service returned no result') }
      return reply
    }
    const work = gates.round(step, service, controller.signal).catch(async (failure: unknown) => {
      console.error('Network gate maintenance requires inspection', failure instanceof Error ? failure.message : 'Maintenance failed')
      controller.abort(failure)
      try { await gates.failStep(step, failure) }
      catch (cleanupFailure) { console.error('Network gate cleanup requires inspection', cleanupFailure instanceof Error ? cleanupFailure.message : 'Cleanup failed') }
    }).finally(() => { this.active.delete(manifest.podId) })
    this.active.set(manifest.podId, { controller, work })
  }

  cancel(podId: string, id: string): void {
    if (this.runs.get(id).podId !== podId) throw new Error('Run belongs to a different pod')
    const lease = this.store.db.prepare('SELECT run_id FROM run_leases WHERE pod_id=?').get(podId)
    if (lease?.run_id !== id) throw new Error('Run is not active')
    this.cancelPod(podId)
  }

  async stop(): Promise<void> {
    const active = [...this.active.values()]
    for (const run of active) run.controller.abort(new RunCancellation('shutdown', 'Application is quitting'))
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
      assertNetworkQuota(this.store, Buffer.byteLength(body) + 4096)
      this.store.transaction(() => {
        const counted = this.store.db.prepare('UPDATE network_invocation_controls SET trace_bytes=trace_bytes+?,trace_count=trace_count+1 WHERE run_id=? AND trace_bytes+?<=2097152 AND trace_count<1000').run(Buffer.byteLength(body), id, Buffer.byteLength(body))
        if (counted.changes !== 1) throw new Error('Network invocation trace budget exceeded')
        this.store.db.prepare('INSERT INTO network_trace_events(network_id,run_id,kind,body,created_at) VALUES(?,?,?,?,?)').run(networkId, id, type, body, Date.now())
      })
    }
    const directory = join(this.store.root, 'runs', id)
    const pendingAgents = new Set<Promise<unknown>>()
    // Agent calls carry their own bounded timeout, so they pause the script budget,
    // up to a per-run total so unawaited calls cannot extend a run indefinitely.
    let activeAgentCalls = 0; let agentPausedMs = 0; let agentSince = 0
    const agentBudgetPaused = () => activeAgentCalls > 0 && agentPausedMs + (Date.now() - agentSince) < maxAgentPauseMs
    let shellScope: RunServiceScope | undefined
    let infrastructureWaiting = 0
    let networkMailReads = 0
    let agentCalls = 0
    let notifications = 0
    let archiveCalls = 0
    let infrastructureFailure: RecoveryFailure | undefined
    const retryService = async <T>(operation: string, work: () => Promise<T>, signal: AbortSignal, budgetMs = 30000) => {
      let waiting = false
      try {
        return await retryInfrastructure(async () => {
          assertCurrent()
          if (waiting && pod.lifecycle === 'active' && this.store.getPod(pod.id).lifecycle !== 'active') {
            this.cancelPod(pod.id, 'Infrastructure retry cancelled because the owner paused execution')
            signal.throwIfAborted()
          }
          try { return await work() }
          catch (error) { if (error instanceof AuthorityError) infrastructureFailure = { cause: 'authority' }; if (error instanceof NonRetryableError && infrastructureFailure?.cause !== 'authority') infrastructureFailure = { cause: 'non-retryable' }; if (error instanceof InfrastructureError) infrastructureFailure = { cause: 'infrastructure', retryAfterMs: error.failure.retryAfterMs }; throw error }
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
      if (network && manifest.capabilities.some(capability => !supportedNetworkCapability(capability))) throw new Error('Network capabilities require declared runtime ports')
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
      const input: RunInput = { home: folders.home, directories: directories.map(({ path, access }) => ({ path, access })), variables: { ...networkInput?.variables, ...new PodVariables(this.store).values(pod.id) }, version: 1, runId: id, podId: pod.id, scriptHash: run.scriptHash, assignmentRevision: pod.bindingRevision, reason: trigger.reason, eventIds: trigger.eventIds, checkpointRevision: checkpoint.revision, checkpoint: checkpoint.body, resourceEpoch: epoch, workspace: folders.workspace, references: snapshots.files.map(file => ({ id: file.id, hash: file.hash, path: file.content })), limits: { timeMs: 300000, frameBytes: 256 * 1024 } }
      const aliases = this.resources.aliases(pod.id)
      if (aliases.length) input.aliases = runAliases(aliases, input.references)
      if (networkInput) { input.config = networkInput.config; input.network = networkInput.network; input.eventIds = networkInput.items.map(item => item.eventId) }
      appendEvent('snapshot', { id: snapshots.id, files: input.references })
      const dependencies = new DependencyStore(this.store); const dependencyHash = dependencies.scriptSet(pod.id, run.scriptHash)
      const dependencyRoot = dependencyHash ? await dependencies.verify(pod.id, dependencyHash) : undefined
      const runtime = { ...this.runtime, dependencyRoot, registerDomain: (path: string, ownerPid: number) => this.runs.registerDomain(id, path, ownerPid) }
      const scope: RunServiceScope = { podId: pod.id, runId: id, epoch, assignmentRevision: pod.bindingRevision, capabilities: manifest.capabilities, root: directory, assertCurrent, registerDomain: runtime.registerDomain }
      if (network) {
        const gates = network.invocations.gates
        if (!gates) throw new Error('Network gate authority is unavailable')
        const coverage = gates.coverage(network.authority)
        for (const approval of coverage) {
          if (!this.services?.gate) throw new Error('Network approval service is unavailable')
          const reply = await boundedStep(30000, async () => {
            const value = await this.services!.gate!({ operation: 'assertActive', manifest: approval.manifest, grants: approval.items.map(item => ({ key: item.deliveryId, id: item.grantId })) }, signal, scope)
            assertCurrent()
            gates.coverage(network.authority)
            return value
          }, () => this.cancelPod(pod.id, 'Network approval verification exceeded its deadline'))
          signal.throwIfAborted()
          if (reply !== true) throw new Error('Network approval is no longer active')
        }
      }
      const invokeTool = async (body: unknown, toolSignal: AbortSignal) => {
        assertCurrent()
        appendEvent('recovery-boundary', { kind: 'read', operation: 'tools.invoke' })
        if (!manifest.capabilities.some(capability => capability === 'mail.read' || capability.startsWith('tool.app_') || capability.startsWith('tool.ssh_')) || !this.services?.tool) throw new Error('No tool capability is assigned to this pod')
        const operation = retryService('tool authorization', async () => { assertCurrent(); return this.services!.tool!(body, toolSignal, scope) }, toolSignal)
        pendingAgents.add(operation)
        try { const reply = await operation; assertCurrent(); return reply }
        finally { pendingAgents.delete(operation) }
      }
      // Script and agent tool calls of a network member share one port: declared source, assigned reads and one read budget.
      const networkTool = async (payload: unknown, toolSignal: AbortSignal) => {
        if (payload !== null && typeof payload === 'object' && ('application' in payload || 'applicationId' in payload) && manifest.capabilities.some(capability => capability.startsWith('tool.app_'))) {
          if (!input.network!.source) throw new Error('Network mail reads require a declared source')
          programRequest(this.resources.list(pod.id), pod.id, manifest.capabilities, payload)
          if (networkMailReads >= 100) throw new Error('Network read budget exceeded')
          networkMailReads++
          appendEvent('network-program-read', { count: networkMailReads })
          return invokeTool(payload, toolSignal)
        }
        if (manifest.capabilities.includes('mail.read')) {
          if (!input.network!.source) throw new Error('Network mail reads require a declared source')
          const request = parseMailRequest(payload, assignedMail(this.resources.list(pod.id)).mail)
          if (networkMailReads >= 100) throw new Error('Network mail read budget exceeded')
          networkMailReads++
          appendEvent('network-mail-read', { operation: request.read.operation, count: networkMailReads })
          return invokeTool(payload, toolSignal)
        }
        throw new Error('Network operation requires a declared runtime port')
      }
      if (this.services?.shell && !network) {
        const environment = await retryService('runtime authorization', () => this.services!.shell!(scope, signal), signal, 30000)
        Object.assign(runtime, { home: environment.home, shell: environment.shell, environment: { ...environment.environment, ...runtime.environment } })
        shellScope = scope
      }
      const contract = manifest.contract === undefined ? undefined : parseGraphContract(manifest.contract)
      const checkEmit = graphEmitter(contract)
      let mail: MailRecipeSession | undefined
      appendEvent('environment', { script: artifact, workspace: input.workspace, values: Object.fromEntries(Object.entries(runtime.environment).filter(([key]) => ['HOME', 'TMPDIR', 'PATH', 'SHELL', 'PODS_POD_ID', 'LANG', 'TERM'].includes(key))) })
      const result = await executeScript(runtime, directory, artifact, input, signal, {
        budgetPaused: () => infrastructureWaiting > 0 || agentBudgetPaused() || this.runs.approvals(pod.id).some(item => item.runId === id),
        event: (type, data) => { assertCurrent(); appendEvent(type, data); if (type === 'process') this.store.db.prepare('UPDATE run_leases SET process_id=? WHERE run_id=?').run((data as { pid: number }).pid, id) },
        request: async (operation, payload, operationSignal) => {
          assertCurrent()
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
          if (operation === 'agent.run') {
            if (!this.services?.provider) throw new Error('Codex is not connected; connect the pod provider before using this script')
            const request = parseAgentRequest(payload)
            if (agentCalls++ >= maxAgentCallsPerRun) throw new Error('A run can start at most 50 agent calls')
            const operation = executeAgent(runtime, directory, request.prompt, input.references.map(file => file.path), { provider: this.services.provider, tool: network ? networkTool : invokeTool }, operationSignal, (event) => { assertCurrent(); appendEvent('agent', event) }, request.tools, request.timeoutSeconds)
            pendingAgents.add(operation); if (activeAgentCalls++ === 0) agentSince = Date.now()
            try { const reply = await operation; assertCurrent(); operationSignal.throwIfAborted(); return reply }
            finally { pendingAgents.delete(operation); if (--activeAgentCalls === 0) agentPausedMs += Date.now() - agentSince }
          }
          if (operation === 'notify') {
            if (notifications++ >= 20) throw new Error('A run can queue at most 20 notifications')
            const receipt = new InboxOutbox(this.store).queue(pod, id, parseNotify(payload))
            appendEvent('notify', receipt); return receipt
          }
          if (network) {
            if (operation === 'tools.invoke') return networkTool(payload, operationSignal)
            if (operation === 'network.archive') {
              const { row, definition, member } = network.invocations.events.authority(network.authority)
              if (!networkArchiveMember(definition, member, manifest.capabilities)) throw new Error('Only a member behind an approval gate with one assigned mail application can archive')
              if (!this.services?.mailMove || !this.services.gate || !network.invocations.gates) throw new Error('Mail archive service is unavailable')
              if (archiveCalls++) throw new Error('A run can archive its approved mail only once')
              const target = parseArchiveTarget(payload)
              const coverage = network.invocations.gates.coverage(network.authority)
              const body = (argv: string[]) => ({ application: target.application, argv })
              const tools = {
                read: async (argv: string[]) => invokeTool(body(argv), operationSignal),
                move: async (argv: string[]) => { appendEvent('recovery-boundary', { kind: 'effect', operation: 'network.archive' }); return this.services!.mailMove!(body(argv), operationSignal, scope) },
                approved: async (approval: NetworkGateCoverage, deliveryId: string) => {
                  const item = approval.items.find(entry => entry.deliveryId === deliveryId)!
                  if (await this.services!.gate!({ operation: 'assertActive', manifest: approval.manifest, grants: [{ key: item.deliveryId, id: item.grantId }] }, operationSignal, scope) !== true) throw new Error('Network approval is no longer active')
                },
              }
              // Archive work pauses the script budget like other bounded service waits, and the run waits for it.
              infrastructureWaiting++
              const work = archiveApproved(this.store, { networkId: definition.id, runId: id, podId: pod.id, owner: { issuer: row.owner_issuer as string, subject: row.owner_subject as string } }, coverage, target, tools, assertCurrent)
              pendingAgents.add(work)
              try {
                const outcomes = await work
                appendEvent('network-archive', { outcomes: outcomes.map(({ deliveryId, outcome, reason }) => ({ deliveryId, outcome, reason })) })
                return outcomes
              }
              finally { pendingAgents.delete(work); infrastructureWaiting-- }
            }
            if (!['graph.contract', 'graph.emit', 'network.emit', 'network.gateCoverage', 'data.get', 'data.put', 'data.delete', 'data.query', 'artifacts.create', 'artifacts.read', 'progress.commit'].includes(operation)) throw new Error('Network operation requires a declared runtime port')
            if (operation === 'data.get') return network.invocations.data.get(network.authority, payload)
            if (operation === 'data.put') return network.invocations.data.put(network.authority, payload)
            if (operation === 'data.delete') return network.invocations.data.put(network.authority, payload, true)
            if (operation === 'data.query') return network.invocations.data.query(network.authority, payload)
            if (operation === 'artifacts.create') return network.invocations.data.artifacts.create(network.authority, payload)
            if (operation === 'artifacts.read') return network.invocations.data.artifacts.read(network.authority, payload)
            if (operation === 'network.gateCoverage') return network.invocations.gates!.scriptCoverage(network.authority)
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
            // Standalone archives record each move in the archive store, which holds only its own unresolved batch.
            appendEvent('recovery-boundary', { kind: 'effect', operation })
            const work = this.services.mailArchive(payload, operationSignal, scope)
            pendingAgents.add(work)
            try { const result = await work; assertCurrent(); return result }
            finally { pendingAgents.delete(work) }
          }
          // A standalone run of a network script receives no items and its emits go nowhere.
          if (operation === 'graph.contract') {
            if (!contract || JSON.stringify(parseGraphContract(payload)) !== JSON.stringify(contract)) throw new Error('Script contract changed since validation')
            return []
          }
          if (operation === 'graph.emit') {
            const emit = checkEmit(payload)
            appendEvent('emit', { channel: emit.channel, key: emit.key }); return { emitted: true }
          }
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
      await this.finish(id, result.status, result.summary, result.status === 'failed' || result.status === 'blocked' ? result.summary : null, result.completedInputIds, epoch, network, infrastructureFailure ?? { cause: 'failure' })
    }
    catch (error) {
      if (network) network.invocations.recordConflict(network.authority, error)
      const message = (error instanceof Error ? error.message : 'Run failed').slice(0, 10000)
      await Promise.allSettled(pendingAgents)
      await this.finish(id, signal.aborted ? 'cancelled' : 'failed', signal.aborted ? 'Run cancelled' : 'Run failed', message, [], epoch, network, signal.aborted ? { cause: signal.reason instanceof RunCancellation ? signal.reason.cause : 'owner-cancelled' } : infrastructureFailure ?? { cause: error instanceof AuthorityError ? 'authority' : error instanceof InfrastructureError ? 'infrastructure' : 'failure', ...(error instanceof InfrastructureError ? { retryAfterMs: error.failure.retryAfterMs } : {}) })
    }
    finally {
      try { if (shellScope) await this.services?.closeShell?.(shellScope) }
      catch (error) { appendEvent('diagnostic', { text: error instanceof Error ? error.message : 'Pod shell cleanup failed' }) }
      finally { if (!network) this.active.delete(pod.id) }
    }
  }

  private async finish(id: string, state: RunState, summary: string, error: string | null, completedInputIds: string[] = [], retryEpoch?: number, network?: NetworkExecution, failure?: RecoveryFailure): Promise<void> {
    if (network) { await network.invocations.finish(network.authority, state, summary, error, completedInputIds, network.emissions, failure ?? { cause: 'failure' }); return }
    try { await confirmDomainsStopped(this.store, id, this.runtime.helper) }
    catch (failure) {
      this.runs.interrupt(id, failure instanceof Error ? failure.message : 'Execution cleanup is unverified')
      return
    }
    this.runs.finish(id, state, summary, error, completedInputIds, retryEpoch, failure)
  }

}
