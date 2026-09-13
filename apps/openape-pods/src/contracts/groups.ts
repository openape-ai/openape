export interface PodGroup { id: string, name: string, collapsed: boolean, podIds: string[] }
export interface Organization { revision: number, groups: PodGroup[] }
export type GroupAction = { action: 'create', name: string } | { action: 'rename', id: string, name: string } | { action: 'remove', id: string } | { action: 'collapse', id: string, collapsed: boolean } | { action: 'move', podId: string, groupId: string | null }
export type GroupCommand = GroupAction & { type: 'organize', revision: number }
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)
export function groupName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100 || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error('Group name must contain 1–100 characters without control characters')
  const name = value.trim().normalize('NFC')
  if (name.toLowerCase() === 'ungrouped') throw new Error('Ungrouped is reserved for pods without a group')
  return name
}
export function parseGroupCommand(value: unknown): GroupCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid group command')
  const command = { ...value } as Record<string, unknown>
  const fields: Record<string, string[]> = { create: ['name'], rename: ['id', 'name'], remove: ['id'], collapse: ['id', 'collapsed'], move: ['podId', 'groupId'] }
  const keys = typeof command.action === 'string' && Object.hasOwn(fields, command.action) ? fields[command.action]! : null
  if (!keys || command.type !== 'organize' || !Number.isSafeInteger(command.revision) || (command.revision as number) < 1 || Object.keys(command).some(key => !['type', 'action', 'revision', ...keys].includes(key))) throw new Error('Invalid group command')
  if (keys.includes('id') && !uuid(command.id)) throw new Error('Invalid group ID')
  if (keys.includes('name')) command.name = groupName(command.name)
  if (command.action === 'collapse' && typeof command.collapsed !== 'boolean') throw new Error('Invalid collapse state')
  if (command.action === 'move' && (!uuid(command.podId) || (command.groupId !== null && !uuid(command.groupId)))) throw new Error('Invalid group membership')
  return structuredClone(command) as GroupCommand
}
export function parseOrganization(value: unknown, podIds: string[]): Organization {
  const state = value as Organization | null
  if (!state || !Number.isSafeInteger(state.revision) || state.revision < 1 || !Array.isArray(state.groups) || state.groups.length > 50) throw new Error('Invalid organization response')
  const seen = new Set<string>(); const assigned = new Set<string>()
  for (const group of state.groups) {
    if (!group || !uuid(group.id) || seen.has(group.id) || groupName(group.name) !== group.name || typeof group.collapsed !== 'boolean' || !Array.isArray(group.podIds)) throw new Error('Invalid group response')
    seen.add(group.id)
    for (const id of group.podIds) { if (!podIds.includes(id) || assigned.has(id)) throw new Error('Invalid membership response'); assigned.add(id) }
  }
  return state
}
