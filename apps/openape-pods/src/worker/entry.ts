import { PodGroups } from './workspace/groups'
import { ScriptWorkspace } from './workspace/scripts'
import { parseScriptCommand } from '../contracts/scripts'
import { DataControl } from './data/control'
import type { DataInternal } from './data/control'
import { SetupControl } from './onboarding/control'
import type { SetupInternal } from './onboarding/control'
import { inspectDomainRecords } from './recovery/domains'
import { parseMasterCommand } from '../contracts/master'
import { MasterControl } from './master/control'
import { MasterService } from './master/service'
import type { AgentRuntime } from './agent/executor'
import type { ServiceCheck } from '../contracts/services'
import { authorizeMailService, authorizeCredentialService, assertMailHistory } from './mail/authorization'
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
const registry = new ResourceRegistry(store, podId => dispatcher.cancelPod(podId, 'Resource permissions changed'))
const dist = join(__dirname, '..').replace('/app.asar/', '/app.asar.unpacked/')
const executable = process.env.PODS_RUNTIME_EXECUTABLE
if (!executable) throw new Error('Trusted runtime executable is missing')
const runtime: AgentRuntime = {
  helper: join(dist, 'native/pods-helper'), executable, entry: join(dist, 'runtime/script-entry.mjs'),
  runtimeDirectories: [dirname(dirname(executable))], environment: { ELECTRON_RUN_AS_NODE: '1' },
  binary: join(dist, 'vendor/codex'), catalog: join(dist, 'vendor/models.json'), manifest: join(dist, 'vendor/manifest.json'), sdkHost: join(dist, 'runtime/sdk-host.mjs'),
}
const runServices: RunServices = { credential: async (alias, signal, scope) => {
  const value = await mailBridge.execute({ podId: scope.podId, runId: scope.runId, epoch: scope.epoch, assignmentRevision: scope.assignmentRevision, capabilities: scope.capabilities }, { alias }, signal, 'credential')
  if (typeof value !== 'string') throw new Error('Invalid credential broker response')
  return value
}, tool: async (body, signal, scope) => {
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
const masterControl = new MasterControl(store, registry, dispatcher, scheduler, runtime)
const scripts = new ScriptWorkspace(store, registry, masterControl)
const scriptController = new AbortController()
const master = new MasterService(store, runtime, masterControl, fixtureProvider)
const recovery = new Recovery(store, registry, scheduler, join(dist, 'native/pods-helper'))
const watcher = new ReferenceWatcher(store, registry, scheduler, join(dist, 'native/pods-helper'))
let scanAt = 0
let storageAt = 0
let maintenance = false
let suspended = false
let startupReady = false
let ticking: Promise<void> | null = null
const timer = setInterval(() => {
  if (ticking || suspended || !startupReady || maintenance) return
  ticking = (async () => {
    try {
      if (Date.now() >= storageAt) {
        storageAt = Date.now() + 5000
        try { await data.retention.view() }
        catch (error) { store.db.prepare('UPDATE data_settings SET error=? WHERE id=1').run(error instanceof Error ? error.message : 'Storage inspection failed') }
      }
      const error = store.db.prepare('SELECT error FROM data_settings WHERE id=1').get()?.error
      if (error) { for (const pod of store.listPods()) dispatcher.cancelPod(pod.id, String(error)); await master.stop(); return }
      if (Date.now() >= scanAt) { await watcher.scan(); scanAt = Date.now() + 15000 }
      if (!suspended) scheduler.tick()
    }
    catch (error) { console.error('Scheduler stopped', error); process.exit(1) }
    finally { ticking = null }
  })()
}, 1000)
port.on('message', async (event) => {
  if (event.data && typeof event.data === 'object' && 'serviceReply' in event.data) { mailBridge.accept(event.data.serviceReply); return }
  if (event.data === 'suspend') { suspended = true; return }
  if (event.data === 'resume') { suspended = false; scanAt = 0; return }
  if (event.data === 'stop') { scriptController.abort(); suspended = true; clearInterval(timer); await ticking; await master.stop(); await dispatcher.stop(); store.close(); process.exit(0) }
  const request = event.data as { id?: unknown, command?: unknown }
  if (!request || typeof request.id !== 'string') throw new Error('Invalid worker request')
  try {
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
      runServices.provider = provider; master.setProvider(provider); startupReady = true
      if (!provider) {
        for (const pod of store.listPods()) dispatcher.cancelPod(pod.id, 'Model connection was removed')
      }
      port.postMessage({ id: request.id, state: true }); return
    }
    if (request.command && typeof request.command === 'object' && 'setup' in request.command) {
      port.postMessage({ id: request.id, state: setup.execute(request.command.setup as SetupInternal) }); return
    }
    if (request.command && typeof request.command === 'object' && 'credentialInventory' in request.command) {
      const assignments = store.listPods().flatMap(pod => registry.list(pod.id).filter(item => item.kind === 'credential' && item.state === 'ready').map(item => ({ podId: pod.id, id: item.configuration.credentialId as string })))
      port.postMessage({ id: request.id, state: assignments }); return
    }
    if (request.command && typeof request.command === 'object' && 'inspectCredentials' in request.command) {
      await inspectDomainRecords(store.db.prepare('SELECT * FROM execution_domains').all(), join(store.root, 'runs'), runtime.helper)
      await data.retention.cleanDeletedFiles(); await data.retention.view()
      port.postMessage({ id: request.id, state: true }); return
    }
    if (request.command && typeof request.command === 'object' && 'master' in request.command) {
      port.postMessage({ id: request.id, state: await master.execute(parseMasterCommand(request.command.master)) }); return
    }
    if (request.command && typeof request.command === 'object' && 'credentialCheck' in request.command) {
      const check = request.command.credentialCheck as ServiceCheck & { alias: string }
      port.postMessage({ id: request.id, state: authorizeCredentialService(store, registry, dispatcher.runs, check, check.alias) }); return
    }
    if (request.command && typeof request.command === 'object' && 'serviceCheck' in request.command) {
      port.postMessage({ id: request.id, state: authorizeMailService(store, registry, dispatcher.runs, request.command.serviceCheck as ServiceCheck) }); return
    }
    if (request.command && typeof request.command === 'object' && 'scripts' in request.command) {
      port.postMessage({ id: request.id, state: await scripts.execute(parseScriptCommand(request.command.scripts), scriptController.signal) }); return
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
    if (request.command && typeof request.command === 'object' && 'run' in request.command) {
      const command = parseRunCommand(request.command.run)
      if (command.type === 'installExample') await dispatcher.install(command.podId, command.variant)
      if (command.type === 'recover') { if (command.action === 'inspect') await recovery.inspect(command.podId, command.runId); else await recovery.retry(command.podId, command.runId) }
      if (command.type === 'retryQueue') recovery.retryQueue(command.podId)
      if (command.type === 'start') scheduler.requestManual(command.podId)
      const id = 'runId' in command ? command.runId : undefined
      if (command.type === 'cancel') dispatcher.cancel(command.podId, command.runId)
      port.postMessage({ id: request.id, state: dispatcher.view(command.podId, id, command.type === 'list' ? command.after : undefined) })
      return
    }
    if (request.command && typeof request.command === 'object' && 'resource' in request.command) {
      const resource = parseResourceCommand(request.command.resource, true)
      if (resource.type === 'saveCredential') throw new Error('Credential values must be stored by the owning main process')
      if (resource.type === 'assignCredential') registry.assignCredential(resource.podId, resource.alias, resource.credentialId, resource.epoch)
      if (resource.type === 'assignReference') registry.assignReference(resource.podId, resource.name, resource.path)
      if (resource.type === 'revoke') registry.revoke(resource.podId, resource.id, resource.revision)
      if (resource.type === 'pickReference') throw new Error('File selection requires the owner window')
      const snapshot = resource.type === 'snapshot' ? await registry.capture(resource.podId, join(__dirname, '../native/pods-helper').replace('/app.asar/', '/app.asar.unpacked/')) : undefined
      port.postMessage({ id: request.id, state: { resources: registry.list(resource.podId), epoch: registry.epoch(resource.podId), ...(snapshot ? { snapshot } : {}) } })
      return
    }
    const command = parseCommand(request.command)
    if (command.type === 'organize') new PodGroups(store).execute(command)
    if (command.type === 'pauseAll') store.db.prepare('UPDATE pods SET lifecycle=\'paused\' WHERE lifecycle=\'active\'').run()
    if (command.type === 'create') store.createPod({ name: command.name, assignment: command.assignment })
    if (command.type === 'update') { store.updatePod(command.id, command.revision, { name: command.name, assignment: command.assignment, lifecycle: command.lifecycle }); dispatcher.cancelPod(command.id, 'Pod assignment changed') }
    port.postMessage({ id: request.id, state: { pods: store.listPods(), organization: new PodGroups(store).view() } })
  }
  catch (error) { port.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'Workspace operation failed' }) }
})
port.postMessage('ready')
