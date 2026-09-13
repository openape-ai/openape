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
port.on('message', async (event) => {
  if (event.data === 'stop') { await dispatcher.stop(); store.close(); process.exit(0) }
  const request = event.data as { id?: unknown, command?: unknown }
  if (!request || typeof request.id !== 'string') throw new Error('Invalid worker request')
  try {
    if (request.command && typeof request.command === 'object' && 'run' in request.command) {
      const command = parseRunCommand(request.command.run)
      if (command.type === 'installExample') await dispatcher.install(command.podId, command.variant)
      const id = command.type === 'start' ? dispatcher.start(command.podId) : 'runId' in command ? command.runId : undefined
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
    if (command.type === 'create') store.createPod({ name: command.name, assignment: command.assignment })
    if (command.type === 'update') { store.updatePod(command.id, command.revision, { name: command.name, assignment: command.assignment, lifecycle: command.lifecycle }); dispatcher.cancelPod(command.id, 'Pod assignment changed') }
    port.postMessage({ id: request.id, state: { pods: store.listPods() } })
  }
  catch (error) { port.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'Workspace operation failed' }) }
})
port.postMessage('ready')
