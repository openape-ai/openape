import { parseJevAvailability } from './jev'
import type { JevAvailability } from './jev'
import { parseGroupCommand, parseOrganization } from './groups'
import type { GroupCommand, Organization } from './groups'
import { parseMapView } from './map-view'
import type { MapView } from './map-view'

export interface StoredPod { id: string, name: string, revision: number, lifecycle: 'active' | 'paused' | 'archived', activeScript: string | null, description?: string }
/** What a network is for, written by the owner. Informational: never part of a definition, pin or hash. */
export interface AutomationDescription { id: string, text: string, revision: number }
export interface WorkspaceState { jev?: JevAvailability | null, pods: StoredPod[], organization: Organization, descriptions?: AutomationDescription[], map?: MapView }
export type WorkspaceCommand = GroupCommand | { type: 'list' } | { type: 'map' } | { type: 'pauseAll' } | { type: 'create', name: string } | { type: 'update', id: string, revision: number, name: string, lifecycle: StoredPod['lifecycle'] } | { type: 'describeAutomation', id: string, revision: number, text: string }
const automationId = /^[a-f0-9-]{36}$/
export function parseCommand(value: unknown): WorkspaceCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid workspace command')
  if ((value as Record<string, unknown>).type === 'organize') return parseGroupCommand(value)
  const command = value as Record<string, unknown>
  const keys = ['list', 'map', 'pauseAll'].includes(command.type as string) ? ['type'] : command.type === 'create' ? ['type', 'name'] : command.type === 'update' ? ['type', 'id', 'revision', 'name', 'lifecycle'] : command.type === 'describeAutomation' ? ['type', 'id', 'revision', 'text'] : []
  if (!keys.length || Object.keys(command).some(key => !keys.includes(key))) throw new Error('Unsupported workspace command')
  if (command.type === 'describeAutomation') {
    if (typeof command.id !== 'string' || !automationId.test(command.id) || !Number.isSafeInteger(command.revision) || (command.revision as number) < 0 || typeof command.text !== 'string' || command.text.length > 1000 || command.text.includes('\0')) throw new Error('Invalid description')
    return structuredClone(command) as WorkspaceCommand
  }
  if (!['list', 'map', 'pauseAll'].includes(command.type as string)) {
    for (const key of ['name']) {
      const text = command[key]
      if (typeof text !== 'string' || !text.trim() || text.includes('\0') || text.length > 100) throw new Error(`Invalid ${key}`)
    }
  }
  if (command.type === 'update' && (typeof command.id !== 'string' || !/^[a-f0-9-]{36}$/.test(command.id) || !Number.isSafeInteger(command.revision) || (command.revision as number) < 1 || !['active', 'paused', 'archived'].includes(command.lifecycle as string))) throw new Error('Invalid pod update')
  return structuredClone(command) as WorkspaceCommand
}
export function parseWorkspace(value: unknown): WorkspaceState {
  if (!value || typeof value !== 'object' || !Array.isArray((value as WorkspaceState).pods)) throw new Error('Invalid workspace response')
  const state = value as WorkspaceState
  if (state.jev !== undefined) state.jev = parseJevAvailability(state.jev)
  if (state.map !== undefined) state.map = parseMapView(state.map)
  for (const pod of state.pods) {
    parseCommand({ type: 'update', id: pod.id, revision: pod.revision, name: pod.name, lifecycle: pod.lifecycle })
    if (pod.activeScript !== null && (typeof pod.activeScript !== 'string' || !/^[a-f0-9]{64}$/.test(pod.activeScript))) throw new Error('Invalid active script')
    if (pod.description !== undefined && (typeof pod.description !== 'string' || pod.description.length > 160)) throw new Error('Invalid pod description')
  }
  parseOrganization(state.organization, state.pods.map(pod => pod.id))
  if (state.descriptions !== undefined && (!Array.isArray(state.descriptions) || state.descriptions.length > 200 || state.descriptions.some(item => !item || typeof item.id !== 'string' || !automationId.test(item.id) || typeof item.text !== 'string' || !item.text || item.text.length > 1000 || !Number.isSafeInteger(item.revision) || item.revision < 1))) throw new Error('Invalid workspace descriptions')
  return state
}
