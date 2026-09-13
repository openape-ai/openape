import { parseDetailsCommand } from '../contracts/details'
import { WorkspaceDetails } from './workspace/details'
import { Recovery } from './recovery/reconcile'
import { parseScheduleCommand } from '../contracts/scheduling'
import { Scheduler } from './scheduling/scheduler'
import { ReferenceWatcher } from './scheduling/references'
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
let dispatcher: RunDispatcher
const registry = new ResourceRegistry(store, podId => dispatcher.cancelPod(podId, 'Resource permissions changed'))
const dist = join(__dirname, '..').replace('/app.asar/', '/app.asar.unpacked/')
const executable = process.env.PODS_RUNTIME_EXECUTABLE
if (!executable) throw new Error('Trusted runtime executable is missing')
dispatcher = new RunDispatcher(store, registry, {
  helper: join(dist, 'native/pods-helper'), executable, entry: join(dist, 'runtime/script-entry.mjs'),
  runtimeDirectories: [dirname(dirname(executable))], environment: { ELECTRON_RUN_AS_NODE: '1' },
  binary: join(dist, 'vendor/codex'), catalog: join(dist, 'vendor/models.json'), manifest: join(dist, 'vendor/manifest.json'), sdkHost: join(dist, 'runtime/sdk-host.mjs'),
})
const details = new WorkspaceDetails(store, registry)
const scheduler = new Scheduler(store, dispatcher)
const recovery = new Recovery(store, registry, scheduler, join(dist, 'native/pods-helper'))
const watcher = new ReferenceWatcher(store, registry, scheduler, join(dist, 'native/pods-helper'))
let scanAt = 0
let suspended = false
let ticking: Promise<void> | null = null
const timer = setInterval(() => {
  if (ticking || suspended) return
  ticking = (async () => {
    try {
      if (Date.now() >= scanAt) { await watcher.scan(); scanAt = Date.now() + 15000 }
      if (!suspended) scheduler.tick()
    }
    catch (error) { console.error('Scheduler stopped', error); process.exit(1) }
    finally { ticking = null }
  })()
}, 1000)
port.on('message', async (event) => {
  if (event.data === 'suspend') { suspended = true; return }
  if (event.data === 'resume') { suspended = false; scanAt = 0; return }
  if (event.data === 'stop') { suspended = true; clearInterval(timer); await ticking; await dispatcher.stop(); store.close(); process.exit(0) }
  const request = event.data as { id?: unknown, command?: unknown }
  if (!request || typeof request.id !== 'string') throw new Error('Invalid worker request')
  try {
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
      if (resource.type === 'assignReference') registry.assignReference(resource.podId, resource.name, resource.path)
      if (resource.type === 'revoke') registry.revoke(resource.podId, resource.id, resource.revision)
      if (resource.type === 'pickReference') throw new Error('File selection requires the owner window')
      const snapshot = resource.type === 'snapshot' ? await registry.capture(resource.podId, join(__dirname, '../native/pods-helper').replace('/app.asar/', '/app.asar.unpacked/')) : undefined
      port.postMessage({ id: request.id, state: { resources: registry.list(resource.podId), epoch: registry.epoch(resource.podId), ...(snapshot ? { snapshot } : {}) } })
      return
    }
    const command = parseCommand(request.command)
    if (command.type === 'pauseAll') store.db.prepare('UPDATE pods SET lifecycle=\'paused\' WHERE lifecycle=\'active\'').run()
    if (command.type === 'create') store.createPod({ name: command.name, assignment: command.assignment })
    if (command.type === 'update') { store.updatePod(command.id, command.revision, { name: command.name, assignment: command.assignment, lifecycle: command.lifecycle }); dispatcher.cancelPod(command.id, 'Pod assignment changed') }
    port.postMessage({ id: request.id, state: { pods: store.listPods() } })
  }
  catch (error) { port.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'Workspace operation failed' }) }
})
port.postMessage('ready')
