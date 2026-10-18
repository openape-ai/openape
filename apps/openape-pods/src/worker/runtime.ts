import { ScriptCredentials } from './resources/script-credentials'
import { releaseProfileLease } from './profile-lease'
import { runtimeParentPort } from './parent-port'
import { ExecutionIdentityBridge } from './runtime/execution-identity'
import { recordProgramExecution } from './runs/program-execution'
import type { ProgramExecutionCheck } from '../contracts/program-execution'
import { occupiedRunSlots } from './runs/slots'
import { assertDataIdle } from './data/backup'
import { automaticBackupDue, runAutomaticBackup } from './data/automatic-backup'
import { InboxOutbox, parseInboxOutboxCommand } from './inbox/outbox'
import { recoverStoppedRuns } from './recovery/automatic'
import { AsyncLocalStorage } from 'node:async_hooks'
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
import { commandPodIds, parseCentralCommand } from '../contracts/central'
import type { AdministrationJournal } from '../contracts/codex-admin'
import { DesktopRegistration } from './remote/registration'
import type { RemoteInternal } from './remote/registration'
import type { RunContextRequest, ServiceCheck  } from '../contracts/services'
import { recoverPortableImports } from './sharing/import'
import { SharingService } from './sharing/service'
import { parseSharingCommand } from '../contracts/sharing'
import { DependencyStore } from './dependencies/store'
import { programRequest } from '../main/programs/invoke'
import { podDirectories } from '../runtime/environment'
import { ProgramControl } from './resources/programs'
import type { ProgramInternal } from './resources/programs'
import { parseHttpReply } from '../contracts/http'
import { PodVariables } from './resources/variables'
import { listedPods } from './workspace/pod-list'
import { mapView } from './workspace/map-view'
import { ItemTagStore } from './workspace/item-tags'
import { DomainAdministration } from './data/admin'
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
import { endpointModel } from './agent/model'
import { authorizeRunService, authorizeCredentialService, readRunContext } from './runtime/service-authorization'
import { ServiceBridge } from './runtime/service-bridge'
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
import { GrantLedger } from './resources/grants'
import type { GrantLedgerCommand } from './resources/grants'
import { parseCommand } from '../contracts/control'
import { openedStore } from './storage/readiness'

const port = runtimeParentPort()
const store = openedStore()
const executionIdentities = new ExecutionIdentityBridge(value => port.postMessage(value))
const serviceBridge = new ServiceBridge(value => port.postMessage(value))
let dispatcher: RunDispatcher
store.onActivated = podId => port.postMessage({ programCancel: podId })
const registry = new ResourceRegistry(store, (podId) => { dispatcher.cancelPod(podId, 'Resource permissions changed', 'authority'); port.postMessage({ programCancel: podId }) })
const dist = join(__dirname, '..').replace('/app.asar/', '/app.asar.unpacked/')
const executable = process.env.PODS_RUNTIME_EXECUTABLE
if (!executable) throw new Error('Trusted runtime executable is missing')
const runtime: AgentRuntime = {
  prepareExecution: (podId, purpose, signal) => executionIdentities.acquire(podId, purpose, signal),
  helper: join(dist, 'native/pods-helper'),
  executable,
  entry: join(dist, 'runtime/script-entry.mjs'),
  runtimeDirectories: [dirname(dirname(executable))],
  environment: { ELECTRON_RUN_AS_NODE: '1' },
  binary: join(dist, 'vendor/codex'),
  catalog: join(dist, 'vendor/models.json'),
  manifest: join(dist, 'vendor/manifest.json'),
  sdkHost: join(dist, 'runtime/sdk-host.mjs'),
}
const runServices: RunServices = {
  prepareStart: async (scope, call, signal) => {
    const { podId, runId, epoch, assignmentRevision, capabilities } = scope
    await serviceBridge.execute({ podId, runId, epoch, assignmentRevision, capabilities }, call, signal, 'scriptGrant')
  },
  shell: async (scope, signal) => {
    const { podId, runId, epoch, assignmentRevision, capabilities } = scope
    return await serviceBridge.execute({ podId, runId, epoch, assignmentRevision, capabilities }, {}, signal, 'shell') as Awaited<ReturnType<NonNullable<RunServices['shell']>>>
  },
  closeShell: async (scope) => {
    const { podId, runId, epoch, assignmentRevision, capabilities } = scope
    await serviceBridge.execute({ podId, runId, epoch, assignmentRevision, capabilities }, {}, AbortSignal.timeout(10000), 'shellClose')
  },
  jev: async (body, signal, scope) => await serviceBridge.execute({ podId: scope.podId, runId: scope.runId, epoch: scope.epoch, assignmentRevision: scope.assignmentRevision, capabilities: scope.capabilities }, body, signal, 'jev') as JevEvaluation,
  http: async (body, signal, scope, summary) => parseHttpReply(await serviceBridge.execute({ podId: scope.podId, runId: scope.runId, epoch: scope.epoch, assignmentRevision: scope.assignmentRevision, capabilities: scope.capabilities }, body, signal, 'http', summary)),
  credential: async (alias, signal, scope) => {
    const value = await serviceBridge.execute({ podId: scope.podId, runId: scope.runId, epoch: scope.epoch, assignmentRevision: scope.assignmentRevision, capabilities: scope.capabilities }, { alias }, signal, 'credential')
    if (typeof value !== 'string') throw new Error('Invalid credential broker response')
    return value
  },
  tool: async (body, signal, scope, summary) => {
    if (body && typeof body === 'object' && 'sshInventory' in body) {
      assignedSsh(registry.list(scope.podId), scope.podId, scope.capabilities, body)
      return serviceBridge.execute({ podId: scope.podId, runId: scope.runId, epoch: scope.epoch, assignmentRevision: scope.assignmentRevision, capabilities: scope.capabilities }, body, signal, undefined, summary)
    }
    if (body && typeof body === 'object' && ('applicationId' in body || 'application' in body)) {
      programRequest(registry.list(scope.podId), scope.podId, scope.capabilities, body)
      return serviceBridge.execute({ podId: scope.podId, runId: scope.runId, epoch: scope.epoch, assignmentRevision: scope.assignmentRevision, capabilities: scope.capabilities }, body, signal, undefined, summary)
    }
    throw new Error('Unsupported tool request; use an assigned application through ape-shell')
  },
}
dispatcher = new RunDispatcher(store, registry, runtime, runServices)
const data = new DataControl(store, runtime.helper)
const setup = new SetupControl(store, registry)
const details = new WorkspaceDetails(store, registry)
const scheduler = new Scheduler(store, dispatcher, Date.now, false, podId => !dispatcher.work.pending(podId))
const fixturePort = process.env.PODS_FIXTURE_MODEL_PORT
const fixtureServices = fixturePort ? { provider: async (body: unknown, signal: AbortSignal) => fetch(`http://127.0.0.1:${fixturePort}/responses`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }), model: endpointModel(`http://127.0.0.1:${fixturePort}/model`) } : undefined
runServices.provider = fixtureServices?.provider; runServices.model = fixtureServices?.model
const recovery = new Recovery(store, registry, scheduler, join(dist, 'native/pods-helper'))
const masterControl = new MasterControl(store, registry, dispatcher, scheduler, runtime, startControlledRun)
const scripts = new ScriptWorkspace(store, registry, masterControl, runtime)
const scriptController = new AbortController()
const master = new MasterService(store, runtime, masterControl, fixtureServices)
const ownerOperations = new AsyncLocalStorage<boolean>()
const codex = new CodexControl(store, masterControl, dispatcher)

const remote = new DesktopRegistration(store)
function registeredOwner() {
  const row = store.db.prepare('SELECT body FROM remote_registration WHERE id=1').get()
  if (!row) throw new Error('This needs an initialized owner identity')
  return parseOwner((JSON.parse(row.body as string) as { owner: unknown }).owner)
}
const watcher = new ReferenceWatcher(store, registry, scheduler, join(dist, 'native/pods-helper'))
const oneShot = process.env.PODS_ONESHOT === '1'
let centralUntil = process.env.PODS_CENTRAL_ENABLED === '1' ? 0 : Infinity
let scanAt = 0
let storageAt = 0
let backupCheckAt = 0
let updateFrozen = false
let maintenance = false
// Owner commands wait for the short automatic backup instead of failing; nobody asked for it, so nobody should see it.
let automaticBackup: Promise<void> | null = null
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
/** One scheduling pass; a failing pass is logged and retried on the next tick so later ticks still run. */
function schedule(): void {
  try { scheduler.tick() }
  catch (error) { console.error('Scheduling failed; retrying on the next tick', error) }
}

function startControlledRun(podId: string, operationId: string, accepted?: (runId: string) => void): string {
  const schedulingAllowed = !oneShot && Date.now() < centralUntil
  if (!startupReady || suspended || maintenance || (!schedulingAllowed && ownerOperations.getStore() !== true)) throw new Error('Controlled execution requires a ready local runtime')
  const maximum = Number(store.db.prepare('SELECT concurrency FROM settings WHERE id=1').get()!.concurrency)
  if (occupiedRunSlots(store) >= maximum) throw new Error('No execution slot available; retry after pending work progresses')
  const runId = dispatcher.start(podId, { reason: 'manual', eventIds: [], operationId }, accepted)
  if (schedulingAllowed) schedule()
  return runId
}

const timer = setInterval(() => {
  if (oneShot || ticking || suspended || !startupReady || maintenance || Date.now() >= centralUntil) return
  tickStartedAt = Date.now()
  ticking = (async () => {
    try {
      try {
        await tickStep('automatic recovery', 15000, () => recoverStoppedRuns(store, runtime.helper, 1))
        await tickStep('run retention', 1000, () => data.retention.runs.prune())
        // The full inventory lstats every profile entry (~1 s on a real profile), so it runs every minute unless a limit is already near.
        if (Date.now() >= storageAt || await data.retention.inspectionDue()) {
          storageAt = Date.now() + 60000
          await tickStep('storage inspection', 60000, () => data.retention.view())
        }
      }
      catch (error) { store.db.prepare('UPDATE data_settings SET error=? WHERE id=1').run(error instanceof Error ? error.message : 'Storage inspection failed') }
      const backups = process.env.PODS_BACKUP_DIRECTORY
      if (backups && Date.now() >= backupCheckAt) {
        backupCheckAt = Date.now() + 60000
        // A data operation that started during this tick keeps its fence; the backup waits for the next check.
        if (await automaticBackupDue(store.root) && !maintenance) {
          maintenance = true
          const backup = tickStep('automatic backup', 600000, () => runAutomaticBackup(store, backups))
          automaticBackup = backup.then(() => undefined, () => undefined)
          try { await backup }
          catch (error) { console.error('Automatic backup failed; the previous verified generation is kept', error) }
          finally { maintenance = false; automaticBackup = null }
        }
      }
      const error = store.db.prepare('SELECT error FROM data_settings WHERE id=1').get()?.error
      if (error) { for (const pod of store.listPods()) dispatcher.cancelPod(pod.id, String(error)); await tickStep('master stop', 60000, () => master.stop()); return }
      if (Date.now() >= scanAt) { await tickStep('reference scan', 120000, () => watcher.scan()); scanAt = Date.now() + 15000 }
      tickPhase = 'scheduling'
      if (!suspended && !maintenance && Date.now() < centralUntil) schedule()
    }
    catch (error) { console.error('Scheduler stopped', error); process.exit(1) }
  })().finally(() => { ticking = null; lastTickAt = Date.now(); tickPhase = '' })
}, 1000)
port.on('message', async (event) => {
  if (event.data && typeof event.data === 'object' && 'executionIdentityReply' in event.data) { executionIdentities.accept(event.data.executionIdentityReply as Parameters<typeof executionIdentities.accept>[0]); return }
  if (event.data && typeof event.data === 'object' && 'serviceReply' in event.data) { serviceBridge.accept(event.data.serviceReply); return }
  if (event.data && typeof event.data === 'object' && 'serviceParked' in event.data) { const { id, parked } = event.data.serviceParked as { id: string, parked: boolean }; serviceBridge.park(id, parked === true); return }
  if (event.data === 'suspend') { suspended = true; return }
  if (event.data === 'resume') { suspended = false; scanAt = 0; return }
  if (event.data === 'stop') { scriptController.abort(); suspended = true; clearInterval(timer); await ticking; await Promise.allSettled(preparing ? [preparing] : []); await master.stop(); await dispatcher.stop(); store.close(); await releaseProfileLease(); process.exit(0) }
  const request = event.data as { id?: unknown, command?: unknown }
  if (!request || typeof request.id !== 'string') throw new Error('Invalid worker request')
  try {
    if (request.command && typeof request.command === 'object' && 'central' in request.command) {
      const command = request.command.central as { type: string, until?: number, owner?: unknown, command?: unknown }
      if (command.type === 'gate') {
        if (typeof command.until !== 'number' || !Number.isFinite(command.until) || command.until < 0 || command.until > Date.now() + 30000) throw new Error('Invalid central lease')
        centralUntil = command.until
        // A tick re-reads centralUntil before scheduling, so closing the gate never needs an unbounded wait.
        if (!centralUntil && ticking) await Promise.race([ticking, delay(5000)])
        port.postMessage({ id: request.id, state: { lastTickAt, tickingSince: ticking ? tickStartedAt : null, tickPhase: ticking ? tickPhase : null, tickTimeout } }); return
      }
      if (command.type === 'assertCommand') {
        // A local-only Pod is published as a placeholder; changing it blind from a browser is refused.
        const targets = commandPodIds(parseCentralCommand(command.command), { workspace: { pods: store.listPods() } })
        if (targets.some(id => store.db.prepare('SELECT 1 FROM local_only_pods WHERE pod_id=?').get(id))) throw new Error('This Pod keeps its data on the desktop; change it there')
        port.postMessage({ id: request.id, state: true }); return
      }
      if (command.type === 'version') { port.postMessage({ id: request.id, state: Number(store.db.prepare('SELECT total_changes() AS changes').get()!.changes) }); return }
      if (command.type !== 'snapshot') throw new Error('Unsupported central worker command')
      port.postMessage({ id: request.id, state: new CentralProjection(store, registry, scripts, dispatcher, scheduler).snapshot(parseOwner(command.owner)) }); return
    }
    await automaticBackup
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
      // Listing pending deletions only reads; main asks at every start, which must not fence other commands.
      if (command.type === 'jobs') { port.postMessage({ id: request.id, state: await data.execute(command) }); return }
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
      const services = endpoint ? { provider: async (body: unknown, signal: AbortSignal) => fetch(`http://127.0.0.1:${endpoint.port}/v1/responses`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endpoint.capability}` }, body: JSON.stringify(body), signal }), model: endpointModel(`http://127.0.0.1:${endpoint.port}/v1/model`, endpoint.capability) } : fixtureServices
      const removed = !!runServices.provider && !services
      runServices.provider = services?.provider; runServices.model = services?.model; master.setProvider(services); providerReady = true; startupReady = processesReady
      if (removed) {
        for (const pod of store.listPods()) dispatcher.cancelPod(pod.id, 'Model connection was removed')
      }
      port.postMessage({ id: request.id, state: true }); return
    }
    if (request.command && typeof request.command === 'object' && 'program' in request.command) { port.postMessage({ id: request.id, state: new ProgramControl(store, registry).execute(request.command.program as ProgramInternal) }); return }
    if (request.command && typeof request.command === 'object' && 'setup' in request.command) {
      port.postMessage({ id: request.id, state: setup.execute(request.command.setup as SetupInternal) }); return
    }
    if (request.command && typeof request.command === 'object' && 'httpCredentialInventory' in request.command) {
      const credentials = new ScriptCredentials(store, registry)
      const assignments = store.listPods().flatMap(pod => credentials.httpAssignments(pod.id))
      port.postMessage({ id: request.id, state: assignments }); return
    }
    if (request.command && typeof request.command === 'object' && 'credentialInventory' in request.command) {
      const assignments = store.listPods().flatMap(pod => registry.list(pod.id).filter(item => (item.kind === 'credential' || item.configuration.type === 'program') && item.state === 'ready').map(item => ({ podId: pod.id, id: (item.configuration.credentialId ?? item.configuration.stateId) as string })))
      port.postMessage({ id: request.id, state: assignments }); return
    }
    if (request.command && typeof request.command === 'object' && 'inspectCredentials' in request.command) {
      await cleanupEncryptedBackupStaging(store.root)
      await recoverStoppedRuns(store, runtime.helper)
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
      const unavailableReason = registered ? undefined : 'Finish desktop identity setup before using reusable definitions.'
      if (command.type === 'list') {
        const state = registered ? new DefinitionWorkspace(store, registry, registeredOwner()).view() : { definitions: [], instances: [], provisioning: [] }
        port.postMessage({ id: request.id, state: { ...state, ...(unavailableReason ? { unavailableReason } : {}) } }); return
      }
      if (command.type === 'previewUpdate' && registered) {
        port.postMessage({ id: request.id, state: await new DefinitionWorkspace(store, registry, registeredOwner()).execute(command, scriptController.signal) }); return
      }
      if (unavailableReason) throw new Error(unavailableReason)
      maintenance = true
      try {
        await ticking
        preparing = new DefinitionWorkspace(store, registry, registeredOwner()).execute(command, scriptController.signal)
        port.postMessage({ id: request.id, state: await preparing })
      }
      finally { preparing = null; maintenance = false }
      return
    }
    if (request.command && typeof request.command === 'object' && 'sharing' in request.command) {
      const command = parseSharingCommand(request.command.sharing)
      if (!store.db.prepare('SELECT 1 FROM remote_registration WHERE id=1').get()) throw new Error('Finish desktop identity setup before sharing packages')
      sharing ??= new SharingService(store, registry, registeredOwner(), join(dirname(runtime.entry), '../vendor/npm'))
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
      const result = new DefinitionWorkspace(store, registry, registeredOwner()).provisioned(receipt.requestId, receipt.error)
      port.postMessage({ id: request.id, state: result }); return
    }
    if (request.command && typeof request.command === 'object' && 'domain' in request.command) {
      port.postMessage({ id: request.id, state: new DomainAdministration(store, dispatcher).execute(request.command.domain) }); return
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
      port.postMessage({ id: request.id, state: readRunContext(store, dispatcher.runs, check.scope) }); return
    }
    if (request.command && typeof request.command === 'object' && 'approvalRelease' in request.command) {
      const release = request.command.approvalRelease as { type?: unknown, keys?: unknown }
      if (release?.type === 'list') { port.postMessage({ id: request.id, state: dispatcher.approvals.releasable() }); return }
      if (release?.type !== 'released' || !Array.isArray(release.keys) || release.keys.some(key => typeof key !== 'string')) throw new Error('Invalid approval release')
      dispatcher.approvals.released(release.keys as string[])
      port.postMessage({ id: request.id, state: true }); return
    }
    if (request.command && typeof request.command === 'object' && 'programExecution' in request.command) {
      const check = request.command.programExecution as ProgramExecutionCheck
      authorizeRunService(store, registry, dispatcher.runs, check)
      recordProgramExecution(store, dispatcher.runs, check)
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
    if (request.command && typeof request.command === 'object' && 'grants' in request.command) {
      port.postMessage({ id: request.id, state: new GrantLedger(store).execute(request.command.grants as GrantLedgerCommand) }); return
    }
    if (request.command && typeof request.command === 'object' && 'secrets' in request.command) {
      port.postMessage({ id: request.id, state: new SecretRequests(store).execute(request.command.secrets as SecretRowCommand) }); return
    }
    if (request.command && typeof request.command === 'object' && 'details' in request.command) {
      port.postMessage({ id: request.id, state: details.execute(parseDetailsCommand(request.command.details)) }); return
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
    if (request.command && typeof request.command === 'object' && 'cliRun' in request.command) {
      const command = parseRunCommand(request.command.cliRun)
      if (command.type !== 'start') throw new Error('Invalid one-shot run')
      const pod = store.getPod(command.podId)
      if (command.expectedScript && command.expectedScript !== pod.activeScript) throw new Error('Active script changed; inspect before running')
      const runId = ownerOperations.run(true, () => startControlledRun(command.podId, request.id as string))
      port.postMessage({ id: request.id, state: { runId, view: dispatcher.view(command.podId, runId) } }); return
    }
    if (request.command && typeof request.command === 'object' && 'run' in request.command) {
      const command = parseRunCommand(request.command.run)
      if (command.type === 'installExample') await dispatcher.install(command.podId, command.variant)
      if (command.type === 'resolveHttp') await recovery.resolveHttp(command.podId, command.runId, command.key, command.applied, command.evidence, command.programOutcome)
      if (command.type === 'recover') { if (command.action === 'inspect') await recovery.inspect(command.podId, command.runId); else await recovery.retry(command.podId, command.runId) }
      if (command.type === 'retryQueue') recovery.retryQueue(command.podId)
      if (command.type === 'start') scheduler.requestManual(command.podId, command.expectedScript)
      if (['start', 'recover', 'retryQueue'].includes(command.type) && startupReady && !suspended && Date.now() < centralUntil) schedule()
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
      if (resource.type === 'bindHttp') registry.assignHttp(resource.podId, resource.permission, resource.epoch, resource.authentication)
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
    if (command.type === 'tag') new ItemTagStore(store).execute(command)
    if (command.type === 'pauseAll') store.db.prepare('UPDATE pods SET lifecycle=\'paused\' WHERE lifecycle=\'active\'').run()
    if (command.type === 'create') store.createPod({ name: command.name })
    if (command.type === 'update') { store.updatePod(command.id, command.revision, { name: command.name, lifecycle: command.lifecycle }); if (command.lifecycle === 'archived') dispatcher.cancelPod(command.id, 'Pod archived') }
    port.postMessage({ id: request.id, state: { jev: jevAvailability(store), pods: listedPods(store), tags: new ItemTagStore(store).view(oneShot), ...(command.type === 'map' ? { map: mapView(store) } : {}) } })
  }
  catch (error) { port.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'Workspace operation failed' }) }
})
port.postMessage('ready')
