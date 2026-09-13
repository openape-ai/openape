import { join } from 'node:path'
import { parseResourceCommand } from '../contracts/resources'
import { ResourceRegistry } from './resources/registry'
import { parseCommand } from '../contracts/control'
import { PodDatabase } from './storage/database'

const port = process.parentPort
if (!port) throw new Error('Pods worker requires its owning Electron process')
const store = new PodDatabase(process.cwd())
const registry = new ResourceRegistry(store, () => {})
port.on('message', async (event) => {
  if (event.data === 'stop') { store.close(); process.exit(0) }
  const request = event.data as { id?: unknown, command?: unknown }
  if (!request || typeof request.id !== 'string') throw new Error('Invalid worker request')
  try {
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
    if (command.type === 'update') store.updatePod(command.id, command.revision, { name: command.name, assignment: command.assignment, lifecycle: command.lifecycle })
    port.postMessage({ id: request.id, state: { pods: store.listPods() } })
  }
  catch (error) { port.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'Workspace operation failed' }) }
})
port.postMessage('ready')
