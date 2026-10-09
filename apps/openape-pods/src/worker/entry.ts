import { assertDataIdle } from './data/backup'
import { InboxOutbox, parseInboxOutboxCommand } from './inbox/outbox'
import { recoverStoppedRuns } from './recovery/automatic'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { CodexNetworkCommand } from '../contracts/codex-networks'
import { CodexNetworks } from './codex/networks'
import type { NetworkCommand, NetworkView } from '../contracts/networks'
import { assertNetworkBrowserCommand } from './central/network-projection'
import { parseCentralCommand } from '../contracts/central'
import { publicNetworkOverview, parseCentralNetworkRead } from '../contracts/central-networks'
import { DefinitionWorkspace } from './workspace/definitions'
import { parseDefinitionCommand, parseDefinitionProvision } from '../contracts/definitions'
import { cleanupEncryptedBackupStaging } from './data/encrypted-backup'
import { jevAvailability } from './onboarding/store'
import { assignedSsh } from '../contracts/ssh'
import type { JevEvaluation } from '../contracts/jev'
import { setTimeout as delay } from 'node:timers/promises'
import { CentralProjection } from './central/projection'
import { boundedStep } from './scheduling/tick-step'
import { parseOwner } from '@openape/pods-protocol'
import { scheduleDomains } from './scheduling/fair-scheduler'
import { NetworkEngine } from './scheduling/network-engine'
import { parseNetworkCommand } from '../contracts/networks'
import type { AdministrationJournal } from '../contracts/codex-admin'
import { DesktopRegistration } from './remote/registration'
import type { RemoteInternal } from './remote/registration'
import { reviewMailBatch, reconcileMailEffect } from './mail/workflow'
import { confirmDomainsStopped } from './recovery/domains'
import { parseWorkflowCommand } from '../contracts/workflows'
import { WorkflowEngine } from './workflows/engine'
import { WorkflowCalls } from './workflows/calls'
import { chooseGateItem, discardGateBatch } from './workflows/gates'
import { graphDetail } from './workflows/detail'
import type { RunContextRequest, ServiceCheck  } from '../contracts/services'
import { DefinitionCatalog } from './workspace/definition-catalog'
import { recoverPortableImports } from './sharing/import'
import { SharingService } from './sharing/service'
import { parseSharingCommand } from '../contracts/sharing'
import { DependencyStore } from './dependencies/store'
import { programRequest } from '../main/programs/invoke'
import { archiveRefusal } from '../contracts/network-capabilities'
import { podDirectories } from '../runtime/environment'
import { ProgramControl } from './resources/programs'
import type { ProgramInternal } from './resources/programs'
import { parseHttpReply } from '../contracts/http'
import { PodVariables } from './resources/variables'
import { PodGroups } from './workspace/groups'
import { listedPods } from './workspace/pod-list'
import { mapView } from './workspace/map-view'
import { CollectionDescriptions } from './workspace/collection-descriptions'
import { SecretRequests } from './secrets/store'
import type { SecretRowCommand } from './secrets/store'
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
store.onActivated = podId => port.postMessage({ programCancel: podId })
const registry = new ResourceRegistry(store, (podId) => { dispatcher.cancelPod(podId, 'Resource permissions changed', 'authority'); port.postMessage({ programCancel: podId }) })
const dist = join(__dirname, '..').replace('/app.asar/', '/app.asar.unpacked/')
const executable = process.env.PODS_RUNTIME_EXECUTABLE
if (!executable) throw new Error('Trusted runtime executable is missing')
const runtime: AgentRuntime = {
  helper: join(dist, 'native/pods-helper'), executable, entry: join(dist, 'runtime/script-entry.mjs'),
  runtimeDirectories: [dirname(dirname(executable))], environment: { ELECTRON_RUN_AS_NODE: '1' },
  binary: join(dist, 'vendor/codex'), catalog: join(dist, 'vendor/models.json'), manifest: join(dist, 'vendor/manifest.json'), sdkHost: join(dist, 'runtime/sdk-host.mjs'),
}
const runServices: RunServices = { gate: async (body, signal, scope) => mailBridge.execute({ podId: scope.podId, runId: scope.runId, epoch: scope.epoch, assignmentRevision: scope.assignmentRevision, capabilities: scope.capabilities }, body, signal, 'gate'), mailArchive: async (body, signal, scope) => mailBridge.execute({ podId: scope.podId, runId: scope.runId, epoch: scope.epoch, assignmentRevision: scope.assignmentRevision, capabilities: scope.capabilities }, body, signal, 'mailArchive'), shell: async (scope, signal) => {
  const { podId, runId, epoch, assignmentRevision, capabilities } = scope
  return await mailBridge.execute({ podId, runId, epoch, assignmentRevision, capabilities }, {}, signal, 'shell') as Awaited<ReturnType<NonNullable<RunServices['shell']>>>
}, closeShell: async (scope) => {
  const { podId, runId, epoch, assignmentRevision, capabilities } = scope
  await mailBridge.execute({ podId, runId, epoch, assignmentRevision, capabilities }, {}, AbortSignal.timeout(10000), 'shellClose')
}, jev: async (body, signal, scope) => await mailBridge.execute({ podId: scope.podId, runId: scope.runId, epoch: scope.epoch, assignmentRevision: scope.assignmentRevision, capabilities: scope.capabilities }, body, signal, 'jev') as JevEvaluation, http: async (body, signal, scope) => parseHttpReply(await mailBridge.execute({ podId: scope.podId, runId: scope.runId, epoch: scope.epoch, assignmentRevision: scope.assignmentRevision, capabilities: scope.capabilities }, body, signal, 'http')), credential: async (alias, signal, scope) => {
  const value = await mailBridge.execute({ podId: scope.podId, runId: scope.runId, epoch: scope.epoch, assignmentRevision: scope.assignmentRevision, capabilities: scope.capabilities }, { alias }, signal, 'credential')
  if (typeof value !== 'string') throw new Error('Invalid credential broker response')
  return value
}, mailMove: async (body, signal, scope) => {
  try { programRequest(registry.list(scope.podId), scope.podId, scope.capabilities, body); signal.throwIfAborted() }
  catch (error) { throw archiveRefusal(error) }
  return mailBridge.execute({ podId: scope.podId, runId: scope.runId, epoch: scope.epoch, assignmentRevision: scope.assignmentRevision, capabilities: scope.capabilities }, body, signal, 'mailMove')
}, tool: async (body, signal, scope) => {
  if (body && typeof body === 'object' && 'sshInventory' in body) {
    assignedSsh(registry.list(scope.podId), scope.podId, scope.capabilities, body)
    return mailBridge.execute({ podId: scope.podId, runId: scope.runId, epoch: scope.epoch, assignmentRevision: scope.assignmentRevision, capabilities: scope.capabilities }, body, signal)
  }
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
const scheduler = new Scheduler(store, dispatcher, Date.now, false)
const fixtureProvider = process.env.PODS_FIXTURE_MODEL_PORT ? async (body: unknown, signal: AbortSignal) => fetch(`http://127.0.0.1:${process.env.PODS_FIXTURE_MODEL_PORT}/responses`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }) : undefined
runServices.provider = fixtureProvider
const recovery = new Recovery(store, registry, scheduler, join(dist, 'native/pods-helper'))
const workflows = new WorkflowEngine(store, dispatcher, recovery, Date.now, false)
const masterControl = new MasterControl(store, registry, dispatcher, scheduler, runtime, workflows, startControlledRun)
const scripts = new ScriptWorkspace(store, registry, masterControl, runtime)
const scriptController = new AbortController()
const master = new MasterService(store, runtime, masterControl, fixtureProvider)
const ownerOperations = new AsyncLocalStorage<boolean>()
const codex = new CodexControl(store, masterControl, new CodexNetworks(store, networkOwner, executeCodexNetwork))

const remote = new DesktopRegistration(store)
function networkOwner() {
  const row = store.db.prepare('SELECT body FROM remote_registration WHERE id=1').get()
  if (!row) throw new Error('Persistent networks require an initialized owner identity')
  return parseOwner((JSON.parse(row.body as string) as { owner: unknown }).owner)
}
const networks = new NetworkEngine(store, dispatcher, registry, runtime.helper, networkOwner, false)
if (process.env.PODS_FIXTURE_GATE_COLLECT === '0') networks.gates.collect = { quietMs: 0, maxMs: 0 }
networks.invocations.calls = new WorkflowCalls(store, networks.invocations.events, workflows)
const watcher = new ReferenceWatcher(store, registry, scheduler, join(dist, 'native/pods-helper'))
let centralNetworkReads = false
let centralUntil = process.env.PODS_CENTRAL_ENABLED === '1' ? 0 : Infinity
let scanAt = 0
let storageAt = 0
let updateFrozen = false
let maintenance = false
let sharing: SharingService | null = null
let preparing: Promise<unknown> | null = null
let suspended = false
let startupReady = false
let providerReady = false
let processesReady = false
let ticking: Promise<void> | null = null
let tickStartedAt = 0
let lastTickAt = 0
let tickPhase = ''
let tickTimeout: { phase: string, at: number } | null = null
function tickStep<T>(phase: string, limitMs: number, work: () => Promise<T>): Promise<T | undefined> {
  tickPhase = phase
  return boundedStep(limitMs, work, () => { tickTimeout = { phase, at: Date.now() }; console.error(`Scheduler step ${phase} did not finish within ${limitMs} ms; continuing`) })
}
async function executeCodexNetwork(command: CodexNetworkCommand): Promise<NetworkView> {
  if ((command.type === 'updateMemberScript' || command.type === 'replayFailed') && (!startupReady || (Date.now() >= centralUntil && ownerOperations.getStore() !== true) || suspended || maintenance)) throw new Error('Network execution requires a ready local runtime')
  if (command.type === 'updateMemberScript') return networks.updateMemberScript(command)
  if (command.type === 'replayFailed') return networks.replayFailed(command)
  return executeNetwork(command, ownerOperations.getStore() === true)
}
async function executeNetwork(command: NetworkCommand, ownerOperation: boolean): Promise<NetworkView> {
  if (command.type === 'create' && !command.draft.expectedSetup) throw new Error('Network creation requires a reviewed setup fingerprint')
  if ((command.type === 'create' || command.type === 'convert') && process.env.PODS_CENTRAL_ENABLED === '1' && !centralNetworkReads) throw new Error('Network creation requires bounded central publication support')
  if ((command.type === 'activate' || command.type === 'process') && (!startupReady || (Date.now() >= centralUntil && !ownerOperation) || suspended || maintenance)) throw new Error('Network execution requires a ready local runtime')
  const result = command.type === 'inspect' || command.type === 'retry' || command.type === 'reconcileEffect' || command.type === 'resolveConflict' || command.type === 'discardFailure' ? await networks.recover(command) : networks.execute(command)
  if (process.env.PODS_CENTRAL_ENABLED === '1' && !centralNetworkReads) result.unavailableReason = 'Network creation requires bounded central publication support'
  if (command.type === 'process' && Date.now() < centralUntil) scheduleDomains(store, [() => scheduler.tick(), () => workflows.tick(), () => { networks.invocations.calls!.tick(); networks.tick() }])
  return result
}

function startControlledRun(podId: string, operationId: string, accepted?: (runId: string) => void): string {
  const schedulingAllowed = Date.now() < centralUntil
  if (!startupReady || suspended || maintenance || (!schedulingAllowed && ownerOperations.getStore() !== true)) throw new Error('Controlled execution requires a ready local runtime')
  let runId: string | null = null
  let failure: unknown
  scheduleDomains(store, [() => {
    const occupied = Number(store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count)
    const maximum = Number(store.db.prepare('SELECT concurrency FROM settings WHERE id=1').get()!.concurrency)
    if (occupied >= maximum) return
    try { runId = dispatcher.start(podId, { reason: 'manual', eventIds: [], operationId }, accepted) }
    catch (error) { failure = error }
    if (schedulingAllowed) scheduler.tick()
  }, () => { if (schedulingAllowed) workflows.tick() }, () => { if (schedulingAllowed) { networks.invocations.calls!.tick(); networks.tick() } }])
  if (failure) throw failure
  if (!runId) throw new Error('No fair execution slot available; retry after pending work progresses')
  return runId
}

const timer = setInterval(() => {
  if (ticking || suspended || !startupReady || maintenance || Date.now() >= centralUntil) return
  tickStartedAt = Date.now()
  ticking = (async () => {
    try {
      try {
        await tickStep('automatic recovery', 15000, () => recoverStoppedRuns(store, runtime.helper, 1))
        await tickStep('workflow cancellations', 20000, () => networks.invocations.calls!.reconcileCancellations())
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
      if (!suspended && !maintenance && Date.now() < centralUntil) {
        scheduleDomains(store, [() => scheduler.tick(), () => workflows.tick(), () => { networks.invocations.calls!.tick(); networks.tick() }])
      }
    }
    catch (error) { console.error('Scheduler stopped', error); process.exit(1) }
  })().finally(() => { ticking = null; lastTickAt = Date.now(); tickPhase = '' })
}, 1000)
port.on('message', async (event) => {
  if (event.data && typeof event.data === 'object' && 'serviceReply' in event.data) { mailBridge.accept(event.data.serviceReply); return }
  if (event.data === 'suspend') { suspended = true; return }
  if (event.data === 'resume') { suspended = false; scanAt = 0; return }
  if (event.data === 'stop') { scriptController.abort(); suspended = true; clearInterval(timer); await ticking; await Promise.allSettled(preparing ? [preparing] : []); await master.stop(); await networks.stop(); await dispatcher.stop(); store.close(); process.exit(0) }
  const request = event.data as { id?: unknown, command?: unknown }
  if (!request || typeof request.id !== 'string') throw new Error('Invalid worker request')
  try {
    if (request.command && typeof request.command === 'object' && 'central' in request.command) {
      const command = request.command.central as { type: string, until?: number, owner?: unknown, networkReads?: boolean, command?: unknown }
      if (command.type === 'gate') {
        if (typeof command.until !== 'number' || !Number.isFinite(command.until) || command.until < 0 || command.until > Date.now() + 30000) throw new Error('Invalid central lease')
        centralUntil = command.until
        // A tick re-reads centralUntil before scheduling, so closing the gate never needs an unbounded wait.
        if (!centralUntil && ticking) await Promise.race([ticking, delay(5000)])
        port.postMessage({ id: request.id, state: { lastTickAt, tickingSince: ticking ? tickStartedAt : null, tickPhase: ticking ? tickPhase : null, tickTimeout } }); return
      }
      if (command.type === 'assertCommand') { assertNetworkBrowserCommand(store, parseCentralCommand(command.command)); port.postMessage({ id: request.id, state: true }); return }
      if (command.type === 'version') { port.postMessage({ id: request.id, state: Number(store.db.prepare('SELECT total_changes() AS changes').get()!.changes) }); return }
      if (command.type === 'networkRead') {
        if (maintenance) throw new Error('Application data is being maintained; retry when it finishes')
        const owner = parseOwner(command.owner)
        new CentralProjection(store, registry, scripts, dispatcher, scheduler).assertOwner(owner)
        const query = parseCentralNetworkRead(command.command)
        const result = networks.execute(query)
        if (query.type === 'list') { port.postMessage({ id: request.id, state: publicNetworkOverview(result) }); return }
        result.networks = result.networks.filter(network => network.id === query.id)
        if (query.type === 'detail') result.gates = result.gates?.filter(gate => gate.networkId === query.id).map(gate => ({ ...gate, url: null }))
        else delete result.gates
        if (query.type === 'detail') result.choices = result.choices?.filter(choice => choice.networkId === query.id)
        else delete result.choices
        port.postMessage({ id: request.id, state: result }); return
      }
      if (command.type !== 'snapshot') throw new Error('Unsupported central worker command')
      centralNetworkReads = command.networkReads === true
      port.postMessage({ id: request.id, state: new CentralProjection(store, registry, scripts, dispatcher, scheduler).snapshot(parseOwner(command.owner), command.networkReads === true) }); return
    }
    if (request.command && typeof request.command === 'object' && 'data' in request.command) {
      const command = request.command.data as DataInternal
      if (command.type === 'releaseUpdate') { if (updateFrozen) { updateFrozen = false; maintenance = false }; port.postMessage({ id: request.id, state: true }); return }
      if (command.type === 'prepareUpdate') {
        if (maintenance) throw new Error('Another data operation is in progress')
        maintenance = true
        try {
          await ticking
          assertDataIdle(store)
          const checkpoint = store.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()
          if (checkpoint?.busy) throw new Error('Database is busy; retry the update later')
          updateFrozen = true
          port.postMessage({ id: request.id, state: true })
        }
        finally { if (!updateFrozen) maintenance = false }
        return
      }
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
      runServices.provider = provider; master.setProvider(provider); providerReady = true; startupReady = processesReady
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
      await cleanupEncryptedBackupStaging(store.root)
      await recoverStoppedRuns(store, runtime.helper)
      await networks.reconcileStartup()
      await new DependencyStore(store).recover(runtime.helper)
      new ProgramControl(store, registry).execute({ type: 'recover' })
      await recoverPortableImports(store)
      await data.retention.cleanDeletedFiles(); await data.retention.view()
      processesReady = true; startupReady = providerReady
      port.postMessage({ id: request.id, state: true }); return
    }
    if (request.command && typeof request.command === 'object' && 'definitions' in request.command) {
      const command = parseDefinitionCommand(request.command.definitions)
      const registered = store.db.prepare('SELECT 1 FROM remote_registration WHERE id=1').get()
      const unavailableReason = !registered ? 'Finish desktop identity setup before using reusable definitions.' : process.env.PODS_CENTRAL_ENABLED === '1' && !centralNetworkReads ? 'Definition editing is not available for this connected workspace yet.' : undefined
      if (command.type === 'list') {
        const state = registered ? new DefinitionWorkspace(store, registry, networkOwner()).view() : { definitions: [], instances: [], provisioning: [] }
        port.postMessage({ id: request.id, state: { ...state, ...(unavailableReason ? { unavailableReason } : {}) } }); return
      }
      if (command.type === 'previewUpdate' && registered) {
        port.postMessage({ id: request.id, state: await new DefinitionWorkspace(store, registry, networkOwner()).execute(command, scriptController.signal) }); return
      }
      if (unavailableReason) throw new Error(unavailableReason)
      maintenance = true
      try {
        await ticking
        preparing = new DefinitionWorkspace(store, registry, networkOwner(), (podId, update) => networks.updateInstance(podId, update)).execute(command, scriptController.signal)
        port.postMessage({ id: request.id, state: await preparing })
      }
      finally { preparing = null; maintenance = false }
      return
    }
    if (request.command && typeof request.command === 'object' && 'sharing' in request.command) {
      const command = parseSharingCommand(request.command.sharing)
      if (!store.db.prepare('SELECT 1 FROM remote_registration WHERE id=1').get()) throw new Error('Finish desktop identity setup before sharing packages')
      // Imported compositions follow the native network creation guard for connected workspaces.
      if (command.scope === 'import' && command.type === 'finalize' && process.env.PODS_CENTRAL_ENABLED === '1' && !centralNetworkReads) throw new Error('Network creation requires bounded central publication support')
      sharing ??= new SharingService(store, registry, networkOwner(), join(dirname(runtime.entry), '../vendor/npm'), { workflows, networks, catalog: new DefinitionCatalog(store, registry, networkOwner()) })
      const slow = (command.scope === 'export' && (command.type === 'review' || command.type === 'download')) || (command.scope === 'import' && command.type === 'prepareDependencies')
      if (!slow) { port.postMessage({ id: request.id, state: await sharing.execute(command, runtime, scriptController.signal) }); return }
      maintenance = true
      try {
        await ticking
        preparing = sharing.execute(command, runtime, scriptController.signal)
        port.postMessage({ id: request.id, state: await preparing })
      }
      finally { preparing = null; maintenance = false }
      return
    }
    if (request.command && typeof request.command === 'object' && 'definitionProvision' in request.command) {
      const receipt = parseDefinitionProvision(request.command.definitionProvision)
      const result = new DefinitionWorkspace(store, registry, networkOwner(), (podId, update) => networks.updateInstance(podId, update)).provisioned(receipt.requestId, receipt.error)
      port.postMessage({ id: request.id, state: result }); return
    }
    if (request.command && typeof request.command === 'object' && 'networks' in request.command) {
      const result = await executeNetwork(parseNetworkCommand(request.command.networks), 'ownerOperation' in request.command && request.command.ownerOperation === true)
      port.postMessage({ id: request.id, state: result }); return
    }
    if (request.command && typeof request.command === 'object' && 'inboxOutbox' in request.command) {
      port.postMessage({ id: request.id, state: new InboxOutbox(store).execute(parseInboxOutboxCommand(request.command.inboxOutbox)) }); return
    }
    if (request.command && typeof request.command === 'object' && 'remote' in request.command) {
      port.postMessage({ id: request.id, state: remote.execute(request.command.remote as RemoteInternal) }); return
    }
    if (request.command && typeof request.command === 'object' && 'codexAdministration' in request.command) {
      port.postMessage({ id: request.id, state: codex.administration(request.command.codexAdministration as AdministrationJournal) }); return
    }
    if (request.command && typeof request.command === 'object' && 'codex' in request.command) {
      const ownerOperation = 'ownerOperation' in request.command && request.command.ownerOperation === true
      const command = parseCodexRequest(request.command.codex)
      const result = await ownerOperations.run(ownerOperation, () => codex.execute(command, AbortSignal.timeout(170000)))
      port.postMessage({ id: request.id, state: result }); return
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
      const network = store.db.prepare('SELECT 1 FROM network_invocations WHERE run_id=?').get(check.scope.runId)
      const maintenance = store.db.prepare('SELECT 1 FROM workflow_gate_attempts WHERE run_id=?').get(check.scope.runId)
      port.postMessage({ id: request.id, state: { name: store.getPod(check.scope.podId).name, reason, runtime: !network && !maintenance } }); return
    }
    if (request.command && typeof request.command === 'object' && 'networkGateCheck' in request.command) {
      const check = request.command.networkGateCheck as ServiceCheck & { manifest: unknown, operation: string, grants?: unknown }
      authorizeRunService(store, registry, dispatcher.runs, check)
      networks.gates.authorizeService(check.scope, check.manifest, check.operation, check.grants)
      port.postMessage({ id: request.id, state: true }); return
    }
    if (request.command && typeof request.command === 'object' && 'serviceCheck' in request.command) {
      const check = request.command.serviceCheck as ServiceCheck
      const state = authorizeRunService(store, registry, dispatcher.runs, check)
      if (check.infrastructure !== undefined) dispatcher.runs.append(check.scope.runId, 'infrastructure', { operation: 'authority monitor', ...(check.infrastructure ?? { state: 'restored' }) })
      if (check.authorityLost) dispatcher.cancelPod(check.scope.podId, 'Pod execution permission is no longer active; review the Pod permissions before retrying', 'authority')
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
    if (request.command && typeof request.command === 'object' && 'secrets' in request.command) {
      port.postMessage({ id: request.id, state: new SecretRequests(store).execute(request.command.secrets as SecretRowCommand) }); return
    }
    if (request.command && typeof request.command === 'object' && 'details' in request.command) {
      port.postMessage({ id: request.id, state: details.execute(parseDetailsCommand(request.command.details)) }); return
    }
    if (request.command && typeof request.command === 'object' && 'workflow' in request.command) {
      const command = parseWorkflowCommand(request.command.workflow)
      if (command.type === 'graph') { port.postMessage({ id: request.id, state: { ...workflows.view(), graph: graphDetail(store, workflows.view().workflows.find(item => item.id === command.id), command.key) } }); return }
      if (command.type !== 'list' && command.type !== 'gateOpen') store.assertStorage()
      if (command.type === 'mailReview') { port.postMessage({ id: request.id, state: { ...workflows.view(), mailReview: reviewMailBatch(store, command.batchId) } }); return }
      if (command.type === 'mailResolve') {
        const review = reviewMailBatch(store, command.resolution.batchId)
        const effect = review?.effects.find(item => item.key === command.resolution.key)
        if (!effect) throw new Error('Mail effect is not awaiting owner reconciliation')
        await confirmDomainsStopped(store, effect.runId, runtime.helper)
        reconcileMailEffect(store, command.resolution)
        port.postMessage({ id: request.id, state: { ...workflows.view(), mailReview: reviewMailBatch(store, command.resolution.batchId) } }); return
      }
      if (command.type === 'publishRevision') workflows.publishRevision(command.id, command.revision, command.ports)
      if (command.type === 'cancelCall') await networks.invocations.calls!.cancel(command.requestId, networkOwner(), command.evidence)
      if (command.type === 'resumeCall') await networks.invocations.calls!.resume(command.requestId, networkOwner(), command.evidence)
      if (command.type === 'resolveCall') await networks.invocations.calls!.resolveIncompleteResult(command.requestId, networkOwner(), command.evidence)
      if (command.type === 'save') workflows.save(command)
      if (command.type === 'delete') workflows.delete(command.id, command.revision)
      if (command.type === 'start') workflows.start(command.id, command.revision)
      if (command.type === 'pause') workflows.pause(command.id, command.revision, command.paused)
      if (command.type === 'retry') await workflows.retry(command.runId, command.podId)
      if (command.type === 'cancel') await workflows.cancel(command.runId)
      if (command.type === 'gateChoose') chooseGateItem(store, command.id, command.gate, command.itemId, command.option, Date.now())
      if (command.type === 'gateDiscard') discardGateBatch(store, command.batchId, Date.now())
      if (command.type !== 'list' && command.type !== 'gateOpen' && startupReady && !suspended && Date.now() < centralUntil) scheduleDomains(store, [() => scheduler.tick(), () => workflows.tick(), () => { networks.invocations.calls!.tick(); networks.tick() }])
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
      if (['start', 'recover', 'retryQueue'].includes(command.type) && startupReady && !suspended && Date.now() < centralUntil) scheduleDomains(store, [() => scheduler.tick(), () => workflows.tick(), () => { networks.invocations.calls!.tick(); networks.tick() }])
      const id = 'runId' in command ? command.runId : undefined
      if (command.type === 'cancel') dispatcher.cancel(command.podId, command.runId)
      port.postMessage({ id: request.id, state: dispatcher.view(command.podId, id, command.type === 'list' ? command.after : undefined) })
      return
    }
    if (request.command && typeof request.command === 'object' && 'resource' in request.command) {
      const resource = parseResourceCommand(request.command.resource, true)
      if (resource.type === 'assignJev') throw new Error('Jev permissions require owner approval')
      if (resource.type === 'bindJev') registry.assignJev(resource.podId, resource.connectionId, resource.model, resource.maxAttempts, resource.authority, resource.epoch)
      if (resource.type === 'bindSsh') registry.assignSsh(resource.podId, resource.binding, resource.authority, resource.epoch)
      if (resource.type === 'bindHttp') registry.assignHttp(resource.podId, resource.permission, resource.authority, resource.epoch, resource.authentication)
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
    if (command.type === 'describeCollection') new CollectionDescriptions(store).execute(command)
    if (command.type === 'pauseAll') store.db.prepare('UPDATE pods SET lifecycle=\'paused\' WHERE lifecycle=\'active\'').run()
    if (command.type === 'create') store.createPod({ name: command.name })
    if (command.type === 'update') { store.updatePod(command.id, command.revision, { name: command.name, lifecycle: command.lifecycle }); if (command.lifecycle === 'archived') dispatcher.cancelPod(command.id, 'Pod archived') }
    port.postMessage({ id: request.id, state: { jev: jevAvailability(store), pods: listedPods(store), organization: new PodGroups(store).view(), descriptions: new CollectionDescriptions(store).view(), ...(command.type === 'map' ? { map: mapView(store) } : {}) } })
  }
  catch (error) { port.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'Workspace operation failed' }) }
})
port.postMessage('ready')
