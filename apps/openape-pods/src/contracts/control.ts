export interface StoredPod { id: string, name: string, assignment: string, revision: number, lifecycle: 'active' | 'paused' | 'archived', activeScript: string | null }
export interface WorkspaceState { pods: StoredPod[] }
export type WorkspaceCommand = { type: 'list' } | { type: 'pauseAll' } | { type: 'create', name: string, assignment: string } | { type: 'update', id: string, revision: number, name: string, assignment: string, lifecycle: StoredPod['lifecycle'] }
export function parseCommand(value: unknown): WorkspaceCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid workspace command')
  const command = value as Record<string, unknown>
  const keys = ['list', 'pauseAll'].includes(command.type as string) ? ['type'] : command.type === 'create' ? ['type', 'name', 'assignment'] : command.type === 'update' ? ['type', 'id', 'revision', 'name', 'assignment', 'lifecycle'] : []
  if (!keys.length || Object.keys(command).some(key => !keys.includes(key))) throw new Error('Unsupported workspace command')
  if (!['list', 'pauseAll'].includes(command.type as string)) {
    for (const key of ['name', 'assignment']) {
      const text = command[key]
      if (typeof text !== 'string' || !text.trim() || text.includes('\0') || text.length > (key === 'name' ? 100 : 20000)) throw new Error(`Invalid ${key}`)
    }
  }
  if (command.type === 'update' && (typeof command.id !== 'string' || !/^[a-f0-9-]{36}$/.test(command.id) || !Number.isSafeInteger(command.revision) || (command.revision as number) < 1 || !['active', 'paused', 'archived'].includes(command.lifecycle as string))) throw new Error('Invalid pod update')
  return structuredClone(command) as WorkspaceCommand
}
export function parseWorkspace(value: unknown): WorkspaceState {
  if (!value || typeof value !== 'object' || !Array.isArray((value as WorkspaceState).pods)) throw new Error('Invalid workspace response')
  const state = value as WorkspaceState
  for (const pod of state.pods) {
    parseCommand({ type: 'update', id: pod.id, revision: pod.revision, name: pod.name, assignment: pod.assignment, lifecycle: pod.lifecycle })
    if (pod.activeScript !== null && (typeof pod.activeScript !== 'string' || !/^[a-f0-9]{64}$/.test(pod.activeScript))) throw new Error('Invalid active script')
  }
  return state
}
