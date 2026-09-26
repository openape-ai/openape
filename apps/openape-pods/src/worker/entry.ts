import { jevAvailability } from './onboarding/store'
import type { JevEvaluation } from '../contracts/jev'
import { setTimeout as delay } from 'node:timers/promises'
import { CentralProjection } from './central/projection'
import { boundedStep } from './scheduling/tick-step'
import { parseOwner } from '@openape/pods-protocol'
import type { AdministrationJournal } from '../contracts/codex-admin'
import { RemoteControl } from './remote/control'
import type { RemoteInternal } from './remote/control'
import { ChatRegistry } from './master/chat-registry'
import { parseChatsCommand } from '../contracts/chats'
import { reviewMailBatch, reconcileMailEffect } from './mail/workflow'
import { confirmDomainsStopped, inspectDomainRecords  } from './recovery/domains'
import { parseWorkflowCommand } from '../contracts/workflows'
import { WorkflowEngine } from './workflows/engine'
import type { RunContextRequest, ServiceCheck  } from '../contracts/services'
import { DependencyStore } from './dependencies/store'
import { programRequest } from '../main/programs/invoke'
import { podDirectories } from '../runtime/environment'
import { ProgramControl } from './resources/programs'
import type { ProgramInternal } from './resources/programs'
import { parseHttpReply } from '../contracts/http'
import { PodVariables } from './resources/variables'
import { PodGroups } from './workspace/groups'
import { ScriptWorkspace } from './workspace/scripts'
import { parseScriptCommand } from '../contracts/scripts'
import { DataControl } from './data/control'
import type { DataInternal } from './data/control'
import { SetupControl } from './onboarding/control'
import type { SetupInternal } from './onboarding/control'
import { parseMasterCommand } from '../contracts/master'
import { MasterControl } from './master/control'
import { MasterService } from './master/service'
import { CodexControl } from './codex/control'
import { parseCodexRequest } from '../contracts/codex'
import type { AgentRuntime } from './agent/executor'
import { authorizeRunService, authorizeCredentialService, assertMailHistory } from './mail/authorization'
import { MailBridge } from './mail/bridge'
import { assignedMail } from '../main/mail/assigned'
import { parseMailRequest } from '../main/mail/contract'
import { ingestMailPage } from './mail/ingestion'
import type { MailArtifact } from '../main/mail/service'
import { parseDetailsCommand } from '../contracts/details'
import { WorkspaceDetails } from './workspace/details'
import { Recovery } from './recovery/reconcile'
import { parseScheduleCommand } from '../contracts/scheduling'
import { Scheduler } from './scheduling/scheduler'
import { ReferenceWatcher } from './scheduling/references'
import type { RunServices } from './runs/dispatcher'
import { RunDispatcher } from './runs/dispatcher'
import { parseRunCommand } from '../contracts/runs'
import { join, dirname } from 'node:path'
import { parseResourceCommand } from '../contracts/resources'
import { ResourceRegistry } from './resources/registry'
import { parseCommand } from '../contracts/control'
import { PodDatabase } from './storage/database'

const port = process.parentPort
if (!port) throw new Error('Pods worker requires its owning Electron process')
const store = new PodDatabase(process.cwd())
const mailBridge = new MailBridge(value => port.postMessage(value))
let dispatcher: RunDispatcher
const registry = new ResourceRegistry(store, (podId) => { dispatcher.cancelPod(podId, 'Resource permissions changed'); port.postMessage({ programCancel: podId }) })
const dist = join(__dirname, '..').replace('/app.asar/', '/app.asar.unpacked/')
const executable = process.env.PODS_RUNTIME_EXECUTABLE
if (!executable) throw new Error('Trusted runtime executable is missing')
const runtime: AgentRuntime = {
  helper: join(dist, 'native/pods-helper'), executable, entry: join(dist, 'runtime/script-entry.mjs'),
  runtimeDirectories: [dirname(dirname(executable))], environment: { ELECTRON_RUN_AS_NODE: '1' },
  binary: join(dist, 'vendor/codex'), catalog: join(dist, 'vendor/models.json'), manifest: join(dist, 'vendor/manifest.json'), sdkHost: join(dist, 'runtime/sdk-host.mjs'),
}
const runServices: RunServices = { shell: async (scope, signal) => {
  const { podId, runId, epoch, assignmentRevision, capabilities } = scope
  return await mailBridge.execute({ podId, runId, epoch, assignmentRevision, capabilities }, {}, signal, 'shell') as Awaited<ReturnType<NonNullable<RunServices['shell']>>>
}, closeShell: async (scope) => {
  const { podId, runId, epoch, assignmentRevision, capabilities } = scope
  await mailBridge.execute({ podId, runId, epoch, assignmentRevision, capabilities }, {}, AbortSignal.timeout(10000), 'shellClose')
}, jev: async (body, signal, scope) => await mailBridge.execute({ podId: scope.podId, runId: scope.runId, epoch: scope.epoch, assignmentRevision: scope.assignmentRevision, capabilities: scope.capabilities }, body, signal, 'jev') as JevEvaluation, http: async (body, signal, scope) => parseHttpReply(await mailBridge.execute({ podId: scope.podId, runId: scope.runId, epoch: scope.epoch, assignmentRevision: scope.assignmentRevision, capabilities: scope.capabilities }, body, signal, 'http')), credential: async (alias, signal, scope) => {
  const value = await mailBridge.execute({ podId: scope.podId, runId: scope.runId, epoch: scope.epoch, assignmentRevision: scope.assignmentRevision, capabilities: scope.capabilities }, { alias }, signal, 'credential')
  if (typeof value !== 'string') throw new Error('Invalid credential broker response')
  return value
}, tool: async (body, signal, scope) => {
  if (body && typeof body === 'object' && ('applicationId' in body || 'application' in body)) {
    programRequest(registry.list(scope.podId), scope.podId, scope.capabilities, body)
    return mailBridge.execute({ podId: scope.podId, runId: scope.runId, epoch: scope.epoch, assignmentRevision: scope.assignmentRevision, capabilities: scope.capabilities }, body, signal)
  }
  const assignment = assignedMail(registry.list(scope.podId))
  const { read } = parseMailRequest(body, assignment.mail)
  assertMailHistory(store, scope.podId, assignment.mail, read)
  const value = await mailBridge.execute({ podId: scope.podId, runId: scope.runId, epoch: scope.epoch, assignmentRevision: scope.assignmentRevision, capabilities: scope.capabilities }, body, signal)
  if (!value || typeof value !== 'object' || typeof (value as MailArtifact).path !== 'string' || typeof (value as MailArtifact).hash !== 'string') throw new Error('Invalid mail broker artifact')
  return ingestMailPage(store, scope.podId, scope.root, value as MailArtifact, assignment.mail, read, scope.assertCurrent)
} }
dispatcher = new RunDispatcher(store, registry, runtime, runServices)
const data = new DataControl(store, runtime.helper)
const setup = new SetupControl(store, registry)
const details = new WorkspaceDetails(store, registry)
const scheduler = new Scheduler(store, dispatcher)
const fixtureProvider = process.env.PODS_FIXTURE_MODEL_PORT ? async (body: unknown, signal: AbortSignal) => fetch(`http://127.0.0.1:${process.env.PODS_FIXTURE_MODEL_PORT}/responses`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }) : undefined
runServices.provider = fixtureProvider
const recovery = new Recovery(store, registry, scheduler, join(dist, 'native/pods-helper'))
const workflows = new WorkflowEngine(store, dispatcher, recovery)
const masterControl = new MasterControl(store, registry, dispatcher, scheduler, runtime, workflows)
const scripts = new ScriptWorkspace(store, registry, masterControl, runtime)
const scriptController = new AbortController()
const master = new MasterService(store, runtime, masterControl, fixtureProvider)
const codex = new CodexControl(store, masterControl)

const remote = new RemoteControl(store, master, dispatcher, registry, scheduler, Date.now, { create: async (podId, applicationId) => String(await mailBridge.remoteProgramState({ operation: 'create', podId, applicationId })), discard: async (podId, stateId) => { await mailBridge.remoteProgramState({ operation: 'discard', podId, stateId }) } })
const watcher = new ReferenceWatcher(store, registry, scheduler, join(dist, 'native/pods-helper'))
let centralUntil = process.env.PODS_CENTRAL_ENABLED === '1' ? 0 : Infinity
let scanAt = 0
let storageAt = 0
let maintenance = false
let preparing: Promise<unknown> | null = null
let suspended = false
let startupReady = false
let preferWorkflow = true
let ticking: Promise<void> | null = null
let tickStartedAt = 0
let lastTickAt = 0
let tickPhase = ''
let tickTimeout: { phase: string, at: number } | null = null
function tickStep<T>(phase: string, limitMs: number, work: () => Promise<T>): Promise<T | undefined> {
  tickPhase = phase
  return boundedStep(limitMs, work, () => { tickTimeout = { phase, at: Date.now() }; console.error(`Scheduler step ${phase} did not finish within ${limitMs} ms; continuing`) })
}
const timer = setInterval(() => {
  if (ticking || suspended || !startupReady || maintenance || Date.now() >= centralUntil) return
  tickStartedAt = Date.now()
  ticking = (async () => {
    try {
      try {
        await tickStep('run retention', 1000, () => data.retention.runs.prune())
        // The full inventory lstats every profile entry (~1 s on a real profile), so it runs every minute unless a limit is already near.
        if (Date.now() >= storageAt || await data.retention.inspectionDue()) {
          storageAt = Date.now() + 60000
          await tickStep('storage inspection', 60000, () => data.retention.view())
        }
      }
      catch (error) { store.db.prepare('UPDATE data_settings SET error=? WHERE id=1').run(error instanceof Error ? error.message : 'Storage inspection failed') }
      const error = store.db.prepare('SELECT error FROM data_settings WHERE id=1').get()?.error
      if (error) { for (const pod of store.listPods()) dispatcher.cancelPod(pod.id, String(error)); await tickStep('master stop', 60000, () => master.stop()); return }
      if (Date.now() >= scanAt) { await tickStep('reference scan', 120000, () => watcher.scan()); scanAt = Date.now() + 15000 }
      tickPhase = 'scheduling'
      if (!suspended && Date.now() < centralUntil) {
        const before = store.db.prepare('SELECT count(*) AS count FROM runs').get()!.count
        if (preferWorkflow) { workflows.tick(); scheduler.tick() }
        else { scheduler.tick(); workflows.tick() }
        if (store.db.prepare('SELECT count(*) AS count FROM runs').get()!.count !== before) preferWorkflow = !preferWorkflow
      }
    }
    catch (error) { console.error('Scheduler stopped', error); process.exit(1) }
  })().finally(() => { ticking = null; lastTickAt = Date.now(); tickPhase = '' })
}, 1000)
port.on('message', async (event) => {
  if (event.data && typeof event.data === 'object' && 'serviceReply' in event.data) { mailBridge.accept(event.data.serviceReply); return }
  if (event.data === 'suspend') { suspended = true; return }
  if (event.data === 'resume') { suspended = false; scanAt = 0; return }
  if (event.data === 'stop') { scriptController.abort(); suspended = true; clearInterval(timer); await ticking; await Promise.allSettled(preparing ? [preparing] : []); await master.stop(); await dispatcher.stop(); store.close(); process.exit(0) }
  const request = event.data as { id?: unknown, command?: unknown }
  if (!request || typeof request.id !== 'string') throw new Error('Invalid worker request')
  try {
    if (request.command && typeof request.command === 'object' && 'central' in request.command) {
      const command = request.command.central as { type: string, until?: number, owner?: unknown }
      if (command.type === 'gate') {
        if (typeof command.until !== 'number' || !Number.isFinite(command.until) || command.until < 0 || command.until > Date.now() + 30000) throw new Error('Invalid central lease')
        centralUntil = command.until
        // A tick re-reads centralUntil before scheduling, so closing the gate never needs an unbounded wait.
        if (!centralUntil && ticking) await Promise.race([ticking, delay(5000)])
        port.postMessage({ id: request.id, state: { lastTickAt, tickingSince: ticking ? tickStartedAt : null, tickPhase: ticking ? tickPhase : null, tickTimeout } }); return
      }
      if (command.type === 'version') { port.postMessage({ id: request.id, state: Number(store.db.prepare('SELECT total_changes() AS changes').get()!.changes) }); return }
      if (command.type !== 'snapshot') throw new Error('Unsupported central worker command')
      port.postMessage({ id: request.id, state: new CentralProjection(store, registry, scripts, dispatcher, scheduler).snapshot(parseOwner(command.owner)) }); return
    }
    if (request.command && typeof request.command === 'object' && 'data' in request.command) {
      const command = request.command.data as DataInternal
      if (maintenance && command.type !== 'status') throw new Error('Another data operation is in progress')
      if (command.type === 'status') { const view = await data.execute(command) as import('../contracts/data').DataView; port.postMessage({ id: request.id, state: { ...view, busy: view.busy || maintenance } }); return }
      maintenance = true
      try { await ticking; port.postMessage({ id: request.id, state: await data.execute(command) }) }
      finally { maintenance = false }
      return
    }
    if (maintenance) throw new Error('Application data is being maintained; retry when it finishes')
    if (request.command && typeof request.command === 'object' && 'provider' in request.command) {
      const endpoint = request.command.provider as { port: number, capability: string } | null
      if (endpoint && (!Number.isInteger(endpoint.port) || endpoint.port < 1024 || endpoint.port > 65535 || !/^[a-f0-9]{64}$/.test(endpoint.capability))) throw new Error('Invalid trusted provider endpoint')
      const provider = endpoint ? async (body: unknown, signal: AbortSignal) => fetch(`http://127.0.0.1:${endpoint.port}/v1/responses`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endpoint.capability}` }, body: JSON.stringify(body), signal }) : fixtureProvider
      const removed = !!runServices.provider && !provider
      runServices.provider = provider; master.setProvider(provider); startupReady = true
      if (removed) {
        for (const pod of store.listPods()) dispatcher.cancelPod(pod.id, 'Model connection was removed')
      }
      port.postMessage({ id: request.id, state: true }); return
    }
    if (request.command && typeof request.command === 'object' && 'program' in request.command) { port.postMessage({ id: request.id, state: new ProgramControl(store, registry).execute(request.command.program as ProgramInternal) }); return }
    if (request.command && typeof request.command === 'object' && 'setup' in request.command) {
      port.postMessage({ id: request.id, state: setup.execute(request.command.setup as SetupInternal) }); return
    }
    if (request.command && typeof request.command === 'object' && 'credentialInventory' in request.command) {
      const assignments = store.listPods().flatMap(pod => registry.list(pod.id).filter(item => (item.kind === 'credential' || item.configuration.type === 'program') && item.state === 'ready').map(item => ({ podId: pod.id, id: (item.configuration.credentialId ?? item.configuration.stateId) as string })))
      port.postMessage({ id: request.id, state: assignments }); return
    }
    if (request.command && typeof request.command === 'object' && 'inspectCredentials' in request.command) {
      await inspectDomainRecords(store.db.prepare('SELECT * FROM execution_domains').all(), join(store.root, 'runs'), runtime.helper)
      await new DependencyStore(store).recover(runtime.helper)
      new ProgramControl(store, registry).execute({ type: 'recover' })
      await data.retention.cleanDeletedFiles(); await data.retention.view()
      port.postMessage({ id: request.id, state: true }); return
    }
    if (request.command && typeof request.command === 'object' && 'remote' in request.command) {
      port.postMessage({ id: request.id, state: await remote.execute(request.command.remote as RemoteInternal) }); return
    }
    if (request.command && typeof request.command === 'object' && 'chats' in request.command) {
      port.postMessage({ id: request.id, state: new ChatRegistry(store).execute(parseChatsCommand(request.command.chats)) }); return
    }
    if (request.command && typeof request.command === 'object' && 'codexAdministration' in request.command) {
      port.postMessage({ id: request.id, state: codex.administration(request.command.codexAdministration as AdministrationJournal) }); return
    }
    if (request.command && typeof request.command === 'object' && 'codex' in request.command) {
      port.postMessage({ id: request.id, state: await codex.execute(parseCodexRequest(request.command.codex), AbortSignal.timeout(170000)) }); return
    }
    if (request.command && typeof request.command === 'object' && 'master' in request.command) {
      port.postMessage({ id: request.id, state: await master.execute(parseMasterCommand(request.command.master)) }); return
    }
    if (request.command && typeof request.command === 'object' && 'credentialCheck' in request.command) {
      const check = request.command.credentialCheck as ServiceCheck & { alias: string }
      port.postMessage({ id: request.id, state: authorizeCredentialService(store, registry, dispatcher.runs, check, check.alias) }); return
    }
    if (request.command && typeof request.command === 'object' && 'runContext' in request.command) {
      const check = request.command.runContext as RunContextRequest
      authorizeRunService(store, registry, dispatcher.runs, check)
      const events = dispatcher.runs.events(check.scope.podId, check.scope.runId)
      const reason = (events.find(item => item.type === 'started')?.data as { reason?: string } | undefined)?.reason ?? 'manual'
      if (check.grant) {
        const { permission, issuer, subject } = check.grant
        const previous = store.db.prepare('SELECT data FROM run_events JOIN runs ON runs.id=run_events.run_id WHERE runs.pod_id=? AND run_events.type=\'approval\' AND json_extract(data,\'$.permission\')=? AND json_extract(data,\'$.issuer\')=? AND json_extract(data,\'$.subject\')=? ORDER BY run_events.at DESC,sequence DESC LIMIT 1').get(check.scope.podId, permission, issuer, subject)
        port.postMessage({ id: request.id, state: previous ? JSON.parse(previous.data as string) : null }); return
      }
      port.postMessage({ id: request.id, state: { name: store.getPod(check.scope.podId).name, reason } }); return
    }
    if (request.command && typeof request.command === 'object' && 'serviceCheck' in request.command) {
      const check = request.command.serviceCheck as ServiceCheck
      const state = authorizeRunService(store, registry, dispatcher.runs, check)
      if (check.authorityLost) dispatcher.cancelPod(check.scope.podId, 'Pod execution permission is no longer active; review the Pod permissions before retrying')
      port.postMessage({ id: request.id, state }); return
    }
    if (request.command && typeof request.command === 'object' && 'scripts' in request.command) {
      const command = parseScriptCommand(request.command.scripts)
      if (command.type !== 'prepareDependencies') { port.postMessage({ id: request.id, state: await scripts.execute(command, scriptController.signal) }); return }
      maintenance = true
      try {
        await ticking
        await data.retention.view()
        preparing = scripts.execute(command, scriptController.signal)
        port.postMessage({ id: request.id, state: await preparing })
      }
      finally { preparing = null; maintenance = false }
      return
    }
    if (request.command && typeof request.command === 'object' && 'details' in request.command) {
      port.postMessage({ id: request.id, state: details.execute(parseDetailsCommand(request.command.details)) }); return
    }
    if (request.command && typeof request.command === 'object' && 'workflow' in request.command) {
      const command = parseWorkflowCommand(request.command.workflow)
      if (command.type !== 'list') store.assertStorage()
      if (command.type === 'mailReview') { port.postMessage({ id: request.id, state: { ...workflows.view(), mailReview: reviewMailBatch(store, command.batchId) } }); return }
      if (command.type === 'mailResolve') {
        const review = reviewMailBatch(store, command.resolution.batchId)
        const effect = review?.effects.find(item => item.key === command.resolution.key)
        if (!effect) throw new Error('Mail effect is not awaiting owner reconciliation')
        await confirmDomainsStopped(store, effect.runId, runtime.helper)
        reconcileMailEffect(store, command.resolution)
        port.postMessage({ id: request.id, state: { ...workflows.view(), mailReview: reviewMailBatch(store, command.resolution.batchId) } }); return
      }
      if (command.type === 'save') workflows.save(command)
      if (command.type === 'delete') workflows.delete(command.id, command.revision)
      if (command.type === 'start') workflows.start(command.id, command.revision)
      if (command.type === 'pause') workflows.pause(command.id, command.revision, command.paused)
      if (command.type === 'retry') await workflows.retry(command.runId, command.podId)
      if (command.type === 'cancel') await workflows.cancel(command.runId)
      if (command.type !== 'list') workflows.tick()
      port.postMessage({ id: request.id, state: workflows.view() })
      return
    }
    if (request.command && typeof request.command === 'object' && 'schedule' in request.command) {
      const command = parseScheduleCommand(request.command.schedule)
      store.getPod(command.podId)
      if (command.type === 'save') scheduler.save(command.podId, command.revision, command.spec, command.enabled)
      if (command.type === 'concurrency') scheduler.concurrency(command.maximum)
      if (command.type === 'lifecycle') scheduler.lifecycle(command.podId, command.revision, command.lifecycle)
      port.postMessage({ id: request.id, state: scheduler.view(command.podId) })
      return
    }
    if (request.command && typeof request.command === 'object' && 'run' in request.command) {
      const command = parseRunCommand(request.command.run)
      if (command.type === 'installExample') await dispatcher.install(command.podId, command.variant)
      if (command.type === 'resolveHttp') await recovery.resolveHttp(command.podId, command.runId, command.key, command.applied, command.evidence)
      if (command.type === 'recover') { if (command.action === 'inspect') await recovery.inspect(command.podId, command.runId); else await recovery.retry(command.podId, command.runId) }
      if (command.type === 'retryQueue') recovery.retryQueue(command.podId)
      if (command.type === 'start') scheduler.requestManual(command.podId, command.expectedScript)
      const id = 'runId' in command ? command.runId : undefined
      if (command.type === 'cancel') dispatcher.cancel(command.podId, command.runId)
      port.postMessage({ id: request.id, state: dispatcher.view(command.podId, id, command.type === 'list' ? command.after : undefined) })
      return
    }
    if (request.command && typeof request.command === 'object' && 'resource' in request.command) {
      const resource = parseResourceCommand(request.command.resource, true)
      if (resource.type === 'assignJev') throw new Error('Jev permissions require owner approval')
      if (resource.type === 'approveJev') registry.assignJev(resource.podId, resource.connectionId, resource.model, resource.maxAttempts, resource.authority, resource.epoch)
      if (resource.type === 'approveHttp') registry.assignHttp(resource.podId, resource.permission, resource.authority, resource.epoch, resource.authentication)
      if (resource.type === 'assignHttp') throw new Error('HTTP permissions require owner approval')
      if (resource.type === 'saveCredential') throw new Error('Credential values must be stored by the owning main process')
      const variables = new PodVariables(store)
      if (resource.type === 'saveVariable') variables.save(resource.podId, resource.name, resource.value, resource.revision)
      if (resource.type === 'removeVariable') variables.remove(resource.podId, resource.name, resource.revision)
      if (resource.type === 'assignCredential') registry.assignCredential(resource.podId, resource.alias, resource.credentialId, resource.epoch)
      if (resource.type === 'assignDirectory') await registry.assignDirectory(resource.podId, resource.path, resource.access, resource.epoch)
      if (resource.type === 'pickDirectory' || resource.type === 'changeDirectory') throw new Error('Directory selection requires owner approval')
      if (resource.type === 'assignReference') registry.assignReference(resource.podId, resource.name, resource.path)
      if (resource.type === 'revoke') registry.revoke(resource.podId, resource.id, resource.revision)
      if (resource.type === 'pickReference') throw new Error('File selection requires the owner window')
      const snapshot = resource.type === 'snapshot' ? await registry.capture(resource.podId, join(__dirname, '../native/pods-helper').replace('/app.asar/', '/app.asar.unpacked/')) : undefined
      const resources = registry.list(resource.podId)
      const directories = await podDirectories(store.root, resource.podId)
      port.postMessage({ id: request.id, state: { jev: jevAvailability(store), directories, variables: variables.list(resource.podId), resources, epoch: registry.epoch(resource.podId), ...(snapshot ? { snapshot } : {}) } })
      return
    }
    const command = parseCommand(request.command)
    if (command.type === 'organize') new PodGroups(store).execute(command)
    if (command.type === 'pauseAll') store.db.prepare('UPDATE pods SET lifecycle=\'paused\' WHERE lifecycle=\'active\'').run()
    if (command.type === 'create') store.createPod({ name: command.name })
    if (command.type === 'update') { store.updatePod(command.id, command.revision, { name: command.name, lifecycle: command.lifecycle }); if (command.lifecycle === 'archived') dispatcher.cancelPod(command.id, 'Pod archived') }
    port.postMessage({ id: request.id, state: { jev: jevAvailability(store), pods: store.listPods(), organization: new PodGroups(store).view() } })
  }
  catch (error) { port.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'Workspace operation failed' }) }
})
port.postMessage('ready')
