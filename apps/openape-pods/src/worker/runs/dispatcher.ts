import { InboxOutbox, parseNotify } from '../inbox/outbox'
import { RunCancellation, unresolvedOperation } from '../recovery/policy'
import type { RecoveryFailure } from '../recovery/policy'
import { AuthorityError, InfrastructureError, NonRetryableError, retryInfrastructure } from '../../contracts/infrastructure'
import { assignedJev, parseJevRequest, parseJevResult } from '../../contracts/jev'
import type { JevRequest, JevEvaluation } from '../../contracts/jev'
import { maxAgentPauseMs, parseAgentRequest } from '../../contracts/agent'
import { DependencyStore } from '../dependencies/store'
import { assignedDirectories } from '../../runtime/directories'
import { podDirectories } from '../../runtime/environment'
import { parseHttpRequest } from '../../contracts/http'
import type { HttpRequest, HttpReply } from '../../contracts/http'
import { assignedHttp } from '../../main/programs/http-service'
import { EffectLedger } from '../recovery/effects'
import { executeHttpEffect } from './http'
import { executeProgramEffect, programWrite } from './program-effects'
import { PodVariables } from '../resources/variables'
import { parseCredentialRead } from '../../contracts/credentials'
import { ScriptCredentials } from '../resources/script-credentials'
import { MailRecipeSession, mailToolRequest } from '../mail/recipe'
import { extractSource } from '../mail/extraction'
import { assignedMail } from '../../main/mail/assigned'
import type { MailPage } from '../mail/ingestion'
import { confirmDomainsStopped } from '../recovery/domains'
import { runAliases, scriptTimeLimitMs } from '../../contracts/runs'
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
import { DomainData } from '../data/domain'
import { WorkLedger } from '../data/work'
import { OwnerQuestions } from '../data/questions'
import { dataOperations, handleDataOperation } from '../data/ports'
import { Approvals } from '../data/approvals'
import type { ApprovalService } from '../data/approvals'
import { archiveApproved, parseArchiveTarget } from '../data/mail-archive'
import { parseOwner } from '@openape/pods-protocol'

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
  jev?: (request: JevRequest, signal: AbortSignal, scope: RunServiceScope) => Promise<JevEvaluation>
  shell?: (scope: RunServiceScope, signal: AbortSignal) => Promise<{ home: string, environment: Record<string, string>, shell?: { cli: string, environment: Record<string, string> } }>
  closeShell?: (scope: RunServiceScope) => Promise<void>
  http?: (request: HttpRequest, signal: AbortSignal, scope: RunServiceScope) => Promise<HttpReply>
  credential?: (alias: string, signal: AbortSignal, scope: RunServiceScope) => Promise<string>
  provider?: AgentGatewayServices['provider']
  tool?: (body: unknown, signal: AbortSignal, scope: RunServiceScope) => Promise<unknown>
  mailMove?: (body: unknown, signal: AbortSignal, scope: RunServiceScope) => Promise<unknown>
  approval?: (body: Parameters<ApprovalService>[0], signal: AbortSignal, scope: RunServiceScope) => Promise<unknown>
}

const maxAgentCallsPerRun = 50

export class RunDispatcher {
  readonly runs: RunStore
  readonly data: DomainData
  readonly work: WorkLedger
  readonly questions: OwnerQuestions
  readonly approvals: Approvals
  private active = new Map<string, { controller: AbortController, work: Promise<void> }>()
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry, private readonly runtime: AgentRuntime, private readonly services?: RunServices) {
    this.runs = new RunStore(store)
    this.data = new DomainData(store)
    this.work = new WorkLedger(store, this.data)
    this.questions = new OwnerQuestions(store, this.data)
    this.approvals = new Approvals(store, () => {
      const registration = store.db.prepare('SELECT body FROM remote_registration WHERE id=1').get()
      if (!registration) throw new Error('Owner approvals require an initialized owner identity')
      return parseOwner((JSON.parse(String(registration.body)) as { owner: unknown }).owner)
    })
    store.transaction(() => {
      store.db.prepare('UPDATE runs SET state=\'interrupted\',error=\'Previous worker stopped; explicit recovery is required\',checkpoint_revision=(SELECT revision FROM checkpoints WHERE pod_id=runs.pod_id) WHERE state=\'running\' AND id IN (SELECT run_id FROM run_leases)').run()
      store.db.prepare('UPDATE run_leases SET boot_id=?').run(`fenced:${this.runs.bootId}`)
      store.db.prepare('UPDATE effect_ledger SET state=\'unknown\' WHERE state=\'intent\'').run()
      store.db.prepare('UPDATE effect_attempts SET state=\'unknown\' WHERE state=\'intent\'').run()
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
    const effects = this.store.db.prepare('SELECT effect_key AS key,run_id AS runId FROM effect_ledger WHERE pod_id=? AND operation IN (\'http.request\',\'program.call\') AND state=\'unknown\' LIMIT 100').all(podId) as { key: string, runId: string }[]
    return { ...(selectedId ? { timing: this.runs.timing(podId, selectedId) } : {}), approvals: this.runs.approvals(podId), effects, runs, events: selectedId ? (after ? this.runs.events(podId, selectedId, after) : this.runs.recentEvents(podId, selectedId)) : [] }
  }

  async install(podId: string, variant: 'deterministic' | 'agent'): Promise<void> {
    const manifest = JSON.parse(await readFile(this.runtime.manifest, 'utf8')) as { dependencyLockHash: string }
    installExample(this.store, this.resources, podId, variant, manifest.dependencyLockHash)
  }

  start(podId: string, trigger: RunTrigger = { reason: 'manual', eventIds: [] }, accepted?: (runId: string) => void): string {
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
    // Agent calls carry their own bounded timeout, so they pause the script budget up to maxAgentPauseMs.
    let activeAgentCalls = 0; let agentPausedMs = 0; let agentSince = 0
    const agentBudgetPaused = () => activeAgentCalls > 0 && agentPausedMs + (Date.now() - agentSince) < maxAgentPauseMs
    let shellScope: RunServiceScope | undefined
    let infrastructureWaiting = 0
    let agentCalls = 0
    let notifications = 0
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
      if (!manifest.triggers.includes(trigger.reason)) throw new Error('Script does not allow this trigger')
      const assigned = this.resources.list(pod.id).filter(resource => resource.kind === 'tool' && resource.state === 'ready').map(resource => resource.configuration.capability)
      if (manifest.capabilities.filter(capability => !capability.startsWith('credential.')).some(capability => !assigned.includes(capability)) || (manifest.capabilities.includes('mail.read') && !this.services?.tool)) throw new Error('No tool assignments are available for this script')
      const artifact = join(directory, 'run.mjs'); await writeFile(artifact, this.store.readBlob(run.scriptHash), { flag: 'wx', mode: 0o400 })
      const snapshots = await this.resources.capture(pod.id, this.runtime.helper)
      assertCurrent()
      const checkpoint = this.store.checkpoint(pod.id)
      const folders = await podDirectories(this.store.root, pod.id)
      const directories = await assignedDirectories(this.store.root, pod.id, this.resources.list(pod.id))
      assertCurrent()
      const input: RunInput = { home: folders.home, directories: directories.map(({ path, access }) => ({ path, access })), variables: new PodVariables(this.store).values(pod.id), version: 1, runId: id, podId: pod.id, scriptHash: run.scriptHash, assignmentRevision: pod.bindingRevision, reason: trigger.reason, eventIds: trigger.eventIds, checkpointRevision: checkpoint.revision, checkpoint: checkpoint.body, resourceEpoch: epoch, workspace: folders.workspace, references: snapshots.files.map(file => ({ id: file.id, hash: file.hash, path: file.content })), limits: { timeMs: scriptTimeLimitMs, frameBytes: 256 * 1024 } }
      const aliases = this.resources.aliases(pod.id)
      if (aliases.length) input.aliases = runAliases(aliases, input.references)
      appendEvent('snapshot', { id: snapshots.id, files: input.references })
      const dependencies = new DependencyStore(this.store); const dependencyHash = dependencies.scriptSet(pod.id, run.scriptHash)
      const dependencyRoot = dependencyHash ? await dependencies.verify(pod.id, dependencyHash) : undefined
      const runtime = { ...this.runtime, dependencyRoot, registerDomain: (path: string, ownerPid: number) => this.runs.registerDomain(id, path, ownerPid) }
      const scope: RunServiceScope = { podId: pod.id, runId: id, epoch, assignmentRevision: pod.bindingRevision, capabilities: manifest.capabilities, root: directory, assertCurrent, registerDomain: runtime.registerDomain }
      let programWrites = 0
      const invokeTool = async (body: unknown, toolSignal: AbortSignal) => {
        assertCurrent()
        if (!manifest.capabilities.some(capability => capability === 'mail.read' || capability.startsWith('tool.app_') || capability.startsWith('tool.ssh_')) || !this.services?.tool) throw new Error('No tool capability is assigned to this pod')
        const call = async () => retryService('tool authorization', async () => { assertCurrent(); return this.services!.tool!(body, toolSignal, scope) }, toolSignal)
        // A read can be replayed; an application write is recorded like an HTTP effect and keeps the run from automatic replay.
        const write = await programWrite(this.resources.list(pod.id), pod.id, scope.capabilities, body)
        if (!write) appendEvent('recovery-boundary', { kind: 'read', operation: 'tools.invoke' })
        const operation = write ? executeProgramEffect(new EffectLedger(this.store), pod.id, id, `program:${id}:${programWrites++}`, body, call) : call()
        pendingAgents.add(operation)
        try { const reply = await operation; assertCurrent(); return reply }
        finally { pendingAgents.delete(operation) }
      }
      const scriptTool = async (payload: unknown, toolSignal: AbortSignal) => invokeTool(payload, toolSignal)
      if (this.services?.shell) {
        const environment = await retryService('runtime authorization', () => this.services!.shell!(scope, signal), signal, 30000)
        Object.assign(runtime, { home: environment.home, shell: environment.shell, environment: { ...environment.environment, ...runtime.environment } })
        shellScope = scope
      }
      // Approval requests and decisions are exchanged with the IdP inside the Pod's own run, after its run authority
      // exists, and finish before the script starts; a slow exchange is aborted, never left running beside the script.
      if (this.services?.approval && this.approvals.due(pod.id)) {
        const service: ApprovalService = (body, serviceSignal) => this.services!.approval!(body, serviceSignal, scope)
        const exchange = new AbortController()
        const stop = () => exchange.abort()
        const timer = setTimeout(stop, 30000)
        signal.addEventListener('abort', stop, { once: true })
        try { await this.approvals.sync(pod.id, service, exchange.signal) }
        catch (error) { appendEvent('approvals', { error: error instanceof Error ? error.message.slice(0, 2000) : 'Approval exchange failed' }) }
        finally { clearTimeout(timer); signal.removeEventListener('abort', stop) }
        assertCurrent()
      }
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
            const operation = executeAgent(runtime, directory, request.prompt, input.references.map(file => file.path), { provider: this.services.provider, tool: scriptTool }, operationSignal, (event) => { assertCurrent(); appendEvent('agent', event) }, request.tools, request.timeoutSeconds)
            pendingAgents.add(operation); if (activeAgentCalls++ === 0) agentSince = Date.now()
            try { const reply = await operation; assertCurrent(); operationSignal.throwIfAborted(); return reply }
            finally { pendingAgents.delete(operation); if (--activeAgentCalls === 0) agentPausedMs += Date.now() - agentSince }
          }
          if (operation === 'notify') {
            if (notifications++ >= 20) throw new Error('A run can queue at most 20 notifications')
            const receipt = new InboxOutbox(this.store).queue(pod, id, parseNotify(payload))
            appendEvent('notify', receipt); return receipt
          }
          if (operation === 'approvals.request') { const view = this.approvals.request({ podId: pod.id, runId: id }, payload); appendEvent('approval-request', { id: view.id, state: view.state }); return view }
          if (operation === 'approvals.get') return this.approvals.get(pod.id, String((payload as { id?: unknown } | null)?.id ?? ''))
          if (operation === 'mail.archiveApproved') {
            if (!this.services?.mailMove || !this.services.approval) throw new Error('Mail archive service is unavailable')
            const target = parseArchiveTarget(payload)
            const service: ApprovalService = (body, serviceSignal) => this.services!.approval!(body, serviceSignal, scope)
            const body = (argv: string[]) => ({ application: target.application, argv })
            const tools = { read: async (argv: string[]) => invokeTool(body(argv), operationSignal), move: async (argv: string[]) => { appendEvent('recovery-boundary', { kind: 'effect', operation: 'mail.archive' }); return this.services!.mailMove!(body(argv), operationSignal, scope) } }
            // Archive work pauses the script budget like other bounded service waits, and the run waits for it.
            infrastructureWaiting++
            const work = archiveApproved(this.store, this.approvals, service, { podId: pod.id, runId: id }, target, tools, assertCurrent, operationSignal)
            pendingAgents.add(work)
            try { const outcome = await work; appendEvent('mail-archive', outcome); return outcome }
            finally { pendingAgents.delete(work); infrastructureWaiting-- }
          }
          if (dataOperations.has(operation)) {
            const reply = handleDataOperation(this, operation, payload, { podId: pod.id, runId: id }, manifest)
            if (operation.startsWith('work.') && operation !== 'work.find' && operation !== 'work.contract') appendEvent('work', { operation, ...(reply && typeof reply === 'object' && 'key' in reply ? { key: (reply as { key: unknown }).key } : {}) })
            return reply
          }
          if (operation === 'mail.archive') {
            if (!this.services?.mailArchive) throw new Error('Mail archive service is unavailable')
            // Standalone archives record each move in the archive store, which holds only its own unresolved batch.
            appendEvent('recovery-boundary', { kind: 'effect', operation })
            const work = this.services.mailArchive(payload, operationSignal, scope)
            pendingAgents.add(work)
            try { const result = await work; assertCurrent(); return result }
            finally { pendingAgents.delete(work) }
          }
          // Channel contracts and emits belonged to the retired network runtime (issue 1465).
          if (operation === 'graph.contract') throw new Error('Network contracts (takes/gives) are retired; declare work and use shared data instead')
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
          if (operation === 'tools.invoke') return scriptTool(payload, operationSignal)
          throw new Error('Unsupported script operation')
        },
      })
      assertCurrent()
      if (this.store.db.prepare('SELECT 1 FROM effect_ledger WHERE run_id=? AND state IN (\'intent\',\'unknown\')').get(id)) throw new Error('An HTTP delivery needs review before this pod can run again')
      for (const gap of result.gapIds) {
        if (!this.store.db.prepare('SELECT 1 FROM claims WHERE pod_id=? AND id=? AND kind=\'gap\'').get(pod.id, gap)) throw new Error('Result references an uncommitted gap')
      }
      if (shellScope) { await this.services?.closeShell?.(shellScope); shellScope = undefined }
      await this.finish(id, result.status, result.summary, result.status === 'failed' || result.status === 'blocked' ? result.summary : null, result.completedInputIds, epoch, infrastructureFailure ?? { cause: 'failure' })
    }
    catch (error) {
      const message = (error instanceof Error ? error.message : 'Run failed').slice(0, 10000)
      await Promise.allSettled(pendingAgents)
      await this.finish(id, signal.aborted ? 'cancelled' : 'failed', signal.aborted ? 'Run cancelled' : 'Run failed', message, [], epoch, signal.aborted ? { cause: signal.reason instanceof RunCancellation ? signal.reason.cause : 'owner-cancelled' } : infrastructureFailure ?? { cause: error instanceof AuthorityError ? 'authority' : error instanceof InfrastructureError ? 'infrastructure' : 'failure', ...(error instanceof InfrastructureError ? { retryAfterMs: error.failure.retryAfterMs } : {}) })
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
      this.work.settleRun(id)
      this.runs.finish(id, state, summary, error, completedInputIds, retryEpoch, failure)
    })
  }

}
