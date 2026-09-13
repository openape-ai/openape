import { parseCommand } from '../contracts/control'
import { PodDatabase } from './storage/database'

const port = process.parentPort
if (!port) throw new Error('Pods worker requires its owning Electron process')
const store = new PodDatabase(process.cwd())
port.on('message', (event) => {
  if (event.data === 'stop') { store.close(); process.exit(0) }
  const request = event.data as { id?: unknown, command?: unknown }
  if (!request || typeof request.id !== 'string') throw new Error('Invalid worker request')
  try {
    const command = parseCommand(request.command)
    if (command.type === 'create') store.createPod({ name: command.name, assignment: command.assignment })
    if (command.type === 'update') store.updatePod(command.id, command.revision, { name: command.name, assignment: command.assignment, lifecycle: command.lifecycle })
    port.postMessage({ id: request.id, state: { pods: store.listPods() } })
  }
  catch (error) { port.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'Workspace operation failed' }) }
})
port.postMessage('ready')
