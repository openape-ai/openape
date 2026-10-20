import { assertCurrentScript } from '../../contracts/retired-storage'
import { scriptFrameBytes } from './response'
import type { OpenApeGrantBatch } from '@openape/core'
import type { SandboxReach } from '../../contracts/sandbox'
import { ApprovalHistory } from '../data/approval-history'
import { isProgramCall } from '../../contracts/program-execution'
import type { ScriptRuntime, ScriptServices } from './runner'
import type { ProgramCall } from '../../main/broker/authorization'
import { executeOwnerScript, ownerScriptAuthority } from './owner-script'
import { InboxOutbox, parseNotify } from '../inbox/outbox'
import { RunCancellation } from '../recovery/policy'
import type { RecoveryFailure } from '../recovery/policy'
import { AuthorityError, InfrastructureError, NonRetryableError, PermissionUnavailableError, retryInfrastructure } from '../../contracts/infrastructure'
import { assignedJev, parseJevRequest, parseJevResult } from '../../contracts/jev'
import type { JevRequest, JevEvaluation } from '../../contracts/jev'
import { maxAgentPauseMs, parseAgentRequest } from '../../contracts/agent'
import type { AgentBackend } from '../../contracts/agent'
import { AgentCallError } from '../../contracts/agent-errors'
import type { AgentCallMetadata } from '../../contracts/agent-metadata'
import type { ProxyAgentCall } from '../agent/proxy-client'
import { DependencyStore } from '../dependencies/store'
import { assignedDirectories } from '../../runtime/directories'
import { podDirectories } from '../../runtime/environment'
import { parseHttpRequest } from '../../contracts/http'
import { splitScriptSummary } from '../../contracts/grant-summary'
import type { ScriptSummary } from '../../contracts/grant-summary'
import type { HttpRequest, HttpReply } from '../../contracts/http'
import { assignedHttp } from '../../main/programs/http-service'
import { EffectLedger } from '../recovery/effects'
import { executeHttpEffect } from './http'
import { PodVariables } from '../resources/variables'
import { parseCredentialRead } from '../../contracts/credentials'
import { ScriptCredentials } from '../resources/script-credentials'
import { confirmDomainsStopped } from '../recovery/domains'
import { assertTimingRequest, runAliases, scriptTimeLimitMs } from '../../contracts/runs'
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
import { releaseHeldWork } from '../recovery/release'

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
  prepareStart?: (scope: RunServiceScope, call: ProgramCall, signal: AbortSignal) => Promise<void>
  jev?: (request: JevRequest, signal: AbortSignal, scope: RunServiceScope) => Promise<JevEvaluation>
  shell?: (scope: RunServiceScope, signal: AbortSignal) => Promise<{ reach?: SandboxReach, home: string, environment: Record<string, string>, shell?: { cli: string, environment: Record<string, string> }, machine?: ScriptRuntime['machine'] }>
  closeShell?: (scope: RunServiceScope) => Promise<void>
  http?: (request: HttpRequest, signal: AbortSignal, scope: RunServiceScope, summary?: ScriptSummary) => Promise<HttpReply>
  credential?: (alias: string, signal: AbortSignal, scope: RunServiceScope) => Promise<string>
  provider?: AgentGatewayServices['provider']
  model?: AgentGatewayServices['model']
  proxy?: ProxyAgentCall
  /** `summary` is the script's own account of the call; the IdP shows it only if the call needs a new grant. */
  tool?: (body: unknown, signal: AbortSignal, scope: RunServiceScope, summary?: ScriptSummary, batch?: OpenApeGrantBatch, reference?: string) => Promise<unknown>
}

const maxAgentCallsPerRun = 50

export class RunDispatcher {
  readonly runs: RunStore
  readonly approvals: ApprovalHistory
  private active = new Map<string, { controller: AbortController, work: Promise<void> }>()
  private agentCalls = new Map<AgentBackend, Set<AbortController>>()
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry, private readonly runtime: AgentRuntime, private readonly services?: RunServices) {
    this.runs = new RunStore(store)
    this.approvals = new ApprovalHistory(store)
    store.transaction(() => {
      store.db.prepare('UPDATE runs SET state=\'interrupted\',error=\'Previous worker stopped\',checkpoint_revision=(SELECT revision FROM checkpoints WHERE pod_id=runs.pod_id) WHERE state=\'running\' AND id IN (SELECT run_id FROM run_leases)').run()
      store.db.prepare('UPDATE run_leases SET boot_id=?').run(`fenced:${this.runs.bootId}`)
      store.db.prepare('UPDATE effect_ledger SET state=\'unknown\' WHERE state=\'intent\'').run()
      releaseHeldWork(store)
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
    return { ...(selectedId ? { timing: this.runs.timing(podId, selectedId) } : {}), approvals: this.runs.approvals(podId), runs, events: selectedId ? (after !== undefined ? this.runs.events(podId, selectedId, after) : this.runs.recentEvents(podId, selectedId)) : [] }
  }

  async install(podId: string, variant: 'deterministic' | 'agent'): Promise<void> {
    const manifest = JSON.parse(await readFile(this.runtime.manifest, 'utf8')) as { dependencyLockHash: string }
    installExample(this.store, this.resources, podId, variant, manifest.dependencyLockHash)
  }

  start(podId: string, trigger: RunTrigger = { reason: 'manual', eventIds: [] }, accepted?: (runId: string) => void): string {
    this.store.assertStorage()
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

  cancelBackend(backend: AgentBackend): void {
    for (const controller of this.agentCalls.get(backend) ?? []) controller.abort(new AgentCallError('cancelled', `${backend === 'native' ? 'Native' : 'Proxy'} agent connection was removed`, { phase: 'request' }))
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

  private async execute(id: string, epoch: number, signal: AbortSignal, trigger: RunTrigger): Promise<void> {
    const run = this.runs.get(id); const pod = this.store.getPod(run.podId)
    const assertCurrent = () => { this.runs.assertLease(id); this.resources.assertCurrent(pod.id, epoch); if (this.store.getPod(pod.id).bindingRevision !== pod.bindingRevision) throw new Error('Script binding changed during the run'); signal.throwIfAborted() }
    const appendEvent = (type: string, data: unknown) => { this.runs.append(id, type, data) }
    const directory = join(this.store.root, 'runs', id)
    const pendingAgents = new Set<Promise<unknown>>()
    const agentLifecycle = new AbortController()
    let unconfirmedProxyCleanup: AgentCallError | undefined
    // Agent calls carry their own bounded timeout, so they pause the script budget up to maxAgentPauseMs.
    let activeAgentCalls = 0; let agentPausedMs = 0; let agentSince = 0
    const agentBudgetPaused = () => activeAgentCalls > 0 && agentPausedMs + (Date.now() - agentSince) < maxAgentPauseMs
    let shellScope: RunServiceScope | undefined
    let infrastructureWaiting = 0
    let agentCalls = 0
    let notifications = 0
    let infrastructureFailure: RecoveryFailure | undefined
    const recordFailure = (failure: RecoveryFailure) => {
      const priority = (cause: RecoveryFailure['cause']) => cause === 'authority' ? 3 : cause === 'non-retryable' ? 2 : cause === 'permission' ? 1 : 0
      if (!infrastructureFailure || priority(failure.cause) >= priority(infrastructureFailure.cause)) infrastructureFailure = failure
    }
    const recordError = (error: unknown) => {
      if (error instanceof PermissionUnavailableError) recordFailure({ cause: 'permission' })
      else if (error instanceof AuthorityError) recordFailure({ cause: 'authority' })
      else if (error instanceof NonRetryableError) recordFailure({ cause: 'non-retryable' })
      else if (error instanceof InfrastructureError) recordFailure({ cause: 'infrastructure', retryAfterMs: error.failure.retryAfterMs })
    }
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
          catch (error) { recordError(error); throw error }
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
      assertCurrentScript(this.store.readBlob(run.scriptHash).toString('utf8'), manifest)
      if (!manifest.triggers.includes(trigger.reason)) throw new Error('Script does not allow this trigger')
      const assigned = this.resources.list(pod.id).filter(resource => resource.kind === 'tool' && resource.state === 'ready').map(resource => resource.configuration.capability)
      if (manifest.capabilities.filter(capability => !capability.startsWith('credential.')).some(capability => !assigned.includes(capability))) throw new Error('No tool assignments are available for this script')
      const artifact = join(directory, 'run.mjs'); await writeFile(artifact, this.store.readBlob(run.scriptHash), { flag: 'wx', mode: 0o400 })
      const snapshots = await this.resources.capture(pod.id, this.runtime.helper)
      assertCurrent()
      const checkpoint = this.store.checkpoint(pod.id)
      const folders = await podDirectories(this.store.root, pod.id)
      const directories = await assignedDirectories(this.store.root, pod.id, this.resources.list(pod.id))
      assertCurrent()
      const input: RunInput = { home: folders.home, directories: directories.map(({ path, access }) => ({ path, access })), variables: new PodVariables(this.store).values(pod.id), version: 1, runId: id, podId: pod.id, scriptHash: run.scriptHash, assignmentRevision: pod.bindingRevision, reason: trigger.reason, eventIds: trigger.eventIds, checkpointRevision: checkpoint.revision, checkpoint: checkpoint.body, resourceEpoch: epoch, workspace: folders.workspace, references: snapshots.files.map(file => ({ id: file.id, hash: file.hash, path: file.content })), limits: { timeMs: scriptTimeLimitMs, frameBytes: scriptFrameBytes } }
      const aliases = this.resources.aliases(pod.id)
      if (aliases.length) input.aliases = runAliases(aliases, input.references)
      if (snapshots.files.length) appendEvent('snapshot', { id: snapshots.id, files: input.references })
      const dependencies = new DependencyStore(this.store); const dependencyHash = dependencies.scriptSet(pod.id, run.scriptHash)
      const dependencyRoot = dependencyHash ? await dependencies.verify(pod.id, dependencyHash) : undefined
      const runtime = { ...this.runtime, dependencyRoot, registerDomain: (path: string, ownerPid: number) => this.runs.registerDomain(id, path, ownerPid) }
      const scope: RunServiceScope = { podId: pod.id, runId: id, epoch, assignmentRevision: pod.bindingRevision, capabilities: manifest.capabilities, root: directory, assertCurrent, registerDomain: runtime.registerDomain }
      const invokeTool = async (body: unknown, toolSignal: AbortSignal, summary?: ScriptSummary, batch?: OpenApeGrantBatch, reference?: string) => {
        assertCurrent()
        if (!manifest.capabilities.some(capability => capability.startsWith('tool.app_') || capability.startsWith('tool.ssh_')) || !this.services?.tool) throw new Error('No tool capability is assigned to this pod')
        const call = async () => retryService('tool authorization', async () => { assertCurrent(); return this.services!.tool!(body, toolSignal, scope, summary, batch, reference) }, toolSignal)
        // The private ape-shell lifecycle records program intent before acknowledging dispatch.
        const operation = call()
        pendingAgents.add(operation)
        try {
          const reply = await operation; assertCurrent()
          if (isProgramCall(body) && reply && typeof reply === 'object' && 'exitCode' in reply && reply.exitCode === 75 && 'pending' in reply && reply.pending && typeof reply.pending === 'object' && 'grantId' in reply.pending && typeof reply.pending.grantId === 'string') recordFailure({ cause: 'permission' })
          return reply
        }
        finally { pendingAgents.delete(operation) }
      }
      const scriptTool = async (payload: unknown, toolSignal: AbortSignal, summary?: ScriptSummary, batch?: OpenApeGrantBatch, reference?: string) => invokeTool(payload, toolSignal, summary, batch, reference)
      if (this.services?.shell) {
        const environment = await retryService('runtime authorization', () => this.services!.shell!(scope, signal), signal, 30000)
        Object.assign(runtime, { reach: environment.reach, home: environment.home, machine: environment.machine, environment: { ...environment.environment, ...runtime.environment } })
        shellScope = scope
      }
      const scriptServices: ScriptServices = {
        authorizeStart: async () => {
          assertCurrent()
          if (this.store.getPod(pod.id).activeScript !== run.scriptHash || !this.store.db.prepare('SELECT 1 FROM validations WHERE pod_id=? AND script_hash=? AND assignment_revision=? AND resource_epoch=?').get(pod.id, run.scriptHash, pod.bindingRevision, epoch)) throw new AuthorityError('Owner activation changed; validate and activate the selected script')
          if (dependencyHash) await dependencies.verify(pod.id, dependencyHash)
          assertCurrent()
          return ownerScriptAuthority(input)
        },
        ...(this.services?.prepareStart ? { prepareStart: async (call: ProgramCall) => { assertCurrent(); await this.services!.prepareStart!(scope, call, signal); assertCurrent() } } : {}),
        budgetPaused: () => infrastructureWaiting > 0 || agentBudgetPaused() || this.runs.approvals(pod.id).some(item => item.runId === id),
        event: (type, data) => { assertCurrent(); appendEvent(type, data); if (type === 'process') this.store.db.prepare('UPDATE run_leases SET process_id=? WHERE run_id=?').run((data as { pid: number }).pid, id) },
        request: async (operation, call, operationSignal) => {
          assertCurrent()
          if (operation === 'run.timing') {
            assertTimingRequest(call)
            operationSignal.throwIfAborted()
            const timing = this.runs.timing(pod.id, id)
            if (!timing) throw new Error('Current run timing is unavailable')
            return timing
          }
          // Approval presentation is separate from the call and its effect identity.
          const { payload, summary, batch, reference } = operation === 'tools.invoke' || operation === 'http.request' ? splitScriptSummary(call) : { payload: call, summary: undefined, batch: undefined, reference: undefined }
          if ((batch || reference) && (operation !== 'tools.invoke' || !isProgramCall(payload))) throw new Error('Approval batches require an assigned application call')
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
            let request
            try { request = parseAgentRequest(payload) }
            catch (error) {
              if (payload && typeof payload === 'object' && 'backend' in payload && payload.backend === 'proxy') recordFailure({ cause: 'non-retryable' })
              throw error
            }
            const backend = request.backend ?? 'native'
            if (backend === 'native' && !this.services?.provider) throw new Error('Codex is not connected; connect the pod provider before using this script')
            if (request.backend === 'proxy' && !this.services?.proxy) { recordFailure({ cause: 'non-retryable' }); throw new AgentCallError('proxy_not_configured', 'Proxy agent backend is not configured', { phase: 'resolve' }) }
            if (agentCalls++ >= maxAgentCallsPerRun) throw new Error('A run can start at most 50 agent calls')
            // Persist before dispatch: a crash can lose every host receipt after inference has started.
            if (request.backend === 'proxy') { this.runs.assertLease(id); appendEvent('agent-dispatch', { backend: 'proxy' }) }
            const controller = new AbortController()
            const calls = this.agentCalls.get(backend) ?? new Set<AbortController>()
            calls.add(controller); this.agentCalls.set(backend, calls)
            const callSignal = AbortSignal.any([operationSignal, signal, agentLifecycle.signal, controller.signal])
            const metadata = (value: AgentCallMetadata) => { this.runs.assertLease(id); appendEvent('agent-call', value) }
            const operation = (request.backend === 'proxy'
              ? this.services!.proxy!(request, callSignal, metadata)
              : executeAgent(runtime, directory, request.prompt, input.references.map(file => file.path), { provider: this.services!.provider!, model: this.services?.model, tool: scriptTool }, callSignal, (event) => { assertCurrent(); appendEvent('agent', event) }, request.tools, request.timeoutSeconds, metadata)).catch((error: unknown) => {
              if (request.backend === 'proxy') recordFailure({ cause: 'non-retryable' })
              if (error instanceof AgentCallError && error.details.cause === 'proxy_cleanup_unconfirmed' && !unconfirmedProxyCleanup) {
                unconfirmedProxyCleanup = error
                // Script-level catch/return cannot prove that its host request has stopped.
                appendEvent('agent-cleanup', { state: 'unconfirmed', backend: 'proxy', hostPid: process.ppid })
              }
              throw error
            })
            pendingAgents.add(operation); if (activeAgentCalls++ === 0) agentSince = Date.now()
            try { const reply = await operation; assertCurrent(); callSignal.throwIfAborted(); return reply }
            finally { calls.delete(controller); pendingAgents.delete(operation); if (--activeAgentCalls === 0) agentPausedMs += Date.now() - agentSince }
          }
          if (operation === 'notify') {
            if (notifications++ >= 20) throw new Error('A run can queue at most 20 notifications')
            const receipt = new InboxOutbox(this.store).queue(pod, id, parseNotify(payload))
            appendEvent('notify', receipt); return receipt
          }
          if (operation === 'http.request') {
            if (!this.services?.http) throw new Error('HTTP service is unavailable')
            const request = parseHttpRequest(payload)
            assignedHttp(this.resources.list(pod.id), scope, request)
            const pending = executeHttpEffect(new EffectLedger(this.store), pod.id, id, request, async () => {
              const result = await retryService('HTTP request', async () => { assertCurrent(); return this.services!.http!(request, operationSignal, scope, summary) }, operationSignal)
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
          if (operation === 'tools.invoke') return scriptTool(payload, operationSignal, summary, batch, reference)
          throw new Error('Unsupported script operation')
        },
      }
      const execute = async (execution?: ScriptServices['execution']) => executeScript(runtime, directory, artifact, input, signal, { ...scriptServices, execution })
      const result = await executeOwnerScript(this.runs, id, ownerScriptAuthority(input), execute)
      agentLifecycle.abort(new Error('Script execution ended'))
      await Promise.allSettled(pendingAgents)
      if (unconfirmedProxyCleanup) { this.runs.interrupt(id, 'Proxy request cleanup is unconfirmed; restart the idle runtime after its previous host has stopped'); return }
      assertCurrent()
      for (const gap of result.gapIds) {
        if (!this.store.db.prepare('SELECT 1 FROM claims WHERE pod_id=? AND id=? AND kind=\'gap\'').get(pod.id, gap)) throw new Error('Result references an uncommitted gap')
      }
      if (shellScope) { await this.services?.closeShell?.(shellScope); shellScope = undefined }
      await this.finish(id, result.status, result.summary, result.status === 'failed' || result.status === 'blocked' ? result.summary : null, result.completedInputIds, epoch, infrastructureFailure ?? { cause: 'failure' })
    }
    catch (error) {
      recordError(error)
      const message = (error instanceof Error ? error.message : 'Run failed').slice(0, 10000)
      agentLifecycle.abort(new Error('Script execution ended'))
      await Promise.allSettled(pendingAgents)
      if (unconfirmedProxyCleanup) { this.runs.interrupt(id, 'Proxy request cleanup is unconfirmed; restart the idle runtime after its previous host has stopped'); return }
      await this.finish(id, signal.aborted ? 'cancelled' : 'failed', signal.aborted ? 'Run cancelled' : 'Run failed', message, [], epoch, signal.aborted ? { cause: signal.reason instanceof RunCancellation ? signal.reason.cause : 'owner-cancelled' } : infrastructureFailure ?? { cause: error instanceof PermissionUnavailableError ? 'permission' : error instanceof AuthorityError ? 'authority' : error instanceof InfrastructureError ? 'infrastructure' : 'failure', ...(error instanceof InfrastructureError ? { retryAfterMs: error.failure.retryAfterMs } : {}) })
    }
    finally {
      try { if (shellScope) await this.services?.closeShell?.(shellScope) }
      catch (error) { appendEvent('diagnostic', { text: error instanceof Error ? error.message : 'Pod shell cleanup failed' }) }
      finally { this.active.delete(pod.id) }
    }
  }

  private async finish(id: string, state: RunState, summary: string, error: string | null, completedInputIds: string[] = [], retryEpoch?: number, failure?: RecoveryFailure): Promise<void> {
    try { await confirmDomainsStopped(this.store, id, this.runtime.helper) }
    catch (failure) {
      this.runs.interrupt(id, failure instanceof Error ? failure.message : 'Execution cleanup is unverified')
      return
    }
    this.store.transaction(() => {
      this.runs.finish(id, state, summary, error, completedInputIds, retryEpoch, failure)
    })
  }

}
