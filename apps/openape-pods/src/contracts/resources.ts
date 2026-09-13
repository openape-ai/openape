export interface PodResource {
  id: string
  podId: string
  revision: number
  kind: 'reference' | 'tool' | 'connection'
  state: 'ready' | 'missing' | 'expired' | 'revoked' | 'refreshRequired'
  name: string
  configuration: Record<string, unknown>
}
export interface ResourceState { resources: PodResource[], epoch: number, snapshot?: { id: string, files: { id: string, hash: string, size: number }[] } }
export type ResourceCommand = { type: 'list' | 'pickReference' | 'snapshot', podId: string } | { type: 'revoke', podId: string, id: string, revision: number }
export type InternalResourceCommand = ResourceCommand | { type: 'assignReference', podId: string, name: string, path: string }
export function parseResourceCommand(value: unknown, internal = false): InternalResourceCommand {
  if (!value || typeof value !== 'object') throw new Error('Invalid resource command')
  const command = value as Record<string, unknown>
  const keys = command.type === 'revoke' ? ['type', 'podId', 'id', 'revision'] : internal && command.type === 'assignReference' ? ['type', 'podId', 'name', 'path'] : ['list', 'pickReference', 'snapshot'].includes(command.type as string) ? ['type', 'podId'] : []
  if (!keys.length || Object.keys(command).some(key => !keys.includes(key)) || typeof command.podId !== 'string' || !/^[a-f0-9-]{36}$/.test(command.podId)) throw new Error('Unsupported resource command')
  if (command.type === 'revoke' && (typeof command.id !== 'string' || !/^[a-f0-9-]{36}$/.test(command.id) || !Number.isSafeInteger(command.revision) || (command.revision as number) < 1)) throw new Error('Invalid resource revocation')
  if (command.type === 'assignReference' && (typeof command.name !== 'string' || !command.name.trim() || command.name.length > 255 || typeof command.path !== 'string' || !command.path.startsWith('/') || /[\0\r\n]/.test(command.path))) throw new Error('Invalid file assignment')
  return structuredClone(command) as InternalResourceCommand
}
export function parseResourceState(value: unknown): ResourceState {
  if (!value || typeof value !== 'object') throw new Error('Invalid resource response')
  const state = value as ResourceState
  if (!Array.isArray(state.resources) || !Number.isSafeInteger(state.epoch) || state.epoch < 0) throw new Error('Invalid resource state')
  for (const resource of state.resources) {
    parseResourceCommand({ type: 'revoke', podId: resource.podId, id: resource.id, revision: resource.revision })
    if (typeof resource.name !== 'string' || !['reference', 'tool', 'connection'].includes(resource.kind) || !['ready', 'missing', 'expired', 'revoked', 'refreshRequired'].includes(resource.state) || !resource.configuration || typeof resource.configuration !== 'object') throw new Error('Invalid resource record')
  }
  if (state.snapshot && (typeof state.snapshot.id !== 'string' || !Array.isArray(state.snapshot.files) || state.snapshot.files.some(file => typeof file.id !== 'string' || !/^[a-f0-9]{64}$/.test(file.hash) || !Number.isSafeInteger(file.size) || file.size < 0))) throw new Error('Invalid snapshot result')
  return state
}
