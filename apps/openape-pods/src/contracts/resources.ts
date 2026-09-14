import { parseHttpPermission } from './http'
import type { HttpPermission } from './http'
import type { ProgramAuthority } from '../main/programs/grants'
import { parseCredentialAlias, parseCredentialValue } from './credentials'

export interface PodResource {
  id: string
  podId: string
  revision: number
  kind: 'reference' | 'tool' | 'connection' | 'credential'
  state: 'ready' | 'missing' | 'expired' | 'revoked' | 'refreshRequired'
  name: string
  configuration: Record<string, unknown>
}
export interface PodVariable { name: string, value: string, revision: number }
export function parseVariable(value: PodVariable): void {
  parseCredentialAlias(value.name)
  if (typeof value.value !== 'string' || value.value.length > 2048 || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Invalid pod variable')
}
export interface ResourceState { variables?: PodVariable[], resources: PodResource[], epoch: number, snapshot?: { id: string, files: { id: string, hash: string, size: number }[] } }
export type ResourceCommand = { type: 'assignHttp', podId: string, epoch: number, permission: HttpPermission } | { type: 'saveVariable', podId: string, name: string, value: string, revision: number } | { type: 'removeVariable', podId: string, name: string, revision: number } | { type: 'saveCredential', podId: string, alias: string, value: string, epoch: number } | { type: 'list' | 'pickReference' | 'snapshot', podId: string } | { type: 'revoke', podId: string, id: string, revision: number }
export type InternalResourceCommand = ResourceCommand | { type: 'approveHttp', podId: string, epoch: number, permission: HttpPermission, authority: ProgramAuthority } | { type: 'assignCredential', podId: string, alias: string, credentialId: string, epoch: number } | { type: 'assignReference', podId: string, name: string, path: string }
export function parseResourceCommand(value: unknown, internal = false): InternalResourceCommand {
  if (!value || typeof value !== 'object') throw new Error('Invalid resource command')
  const command = value as Record<string, unknown>
  const keys = command.type === 'assignHttp' ? ['type', 'podId', 'epoch', 'permission'] : internal && command.type === 'approveHttp' ? ['type', 'podId', 'epoch', 'permission', 'authority'] : command.type === 'saveVariable' ? ['type', 'podId', 'name', 'value', 'revision'] : command.type === 'removeVariable' ? ['type', 'podId', 'name', 'revision'] : command.type === 'saveCredential' ? ['type', 'podId', 'alias', 'value', 'epoch'] : internal && command.type === 'assignCredential' ? ['type', 'podId', 'alias', 'credentialId', 'epoch'] : command.type === 'revoke' ? ['type', 'podId', 'id', 'revision'] : internal && command.type === 'assignReference' ? ['type', 'podId', 'name', 'path'] : ['list', 'pickReference', 'snapshot'].includes(command.type as string) ? ['type', 'podId'] : []
  if (!keys.length || Object.keys(command).some(key => !keys.includes(key)) || typeof command.podId !== 'string' || !/^[a-f0-9-]{36}$/.test(command.podId)) throw new Error('Unsupported resource command')
  if (command.type === 'assignHttp' || command.type === 'approveHttp') {
    command.permission = parseHttpPermission(command.permission)
    if (!Number.isSafeInteger(command.epoch) || Number(command.epoch) < 0) throw new Error('Invalid HTTP permission revision')
  }
  if (command.type === 'revoke' && (typeof command.id !== 'string' || !/^[a-f0-9-]{36}$/.test(command.id) || !Number.isSafeInteger(command.revision) || (command.revision as number) < 1)) throw new Error('Invalid resource revocation')
  if (command.type === 'assignReference' && (typeof command.name !== 'string' || !command.name.trim() || command.name.length > 255 || typeof command.path !== 'string' || !command.path.startsWith('/') || /[\0\r\n]/.test(command.path))) throw new Error('Invalid file assignment')
  if (command.type === 'saveCredential' || command.type === 'assignCredential') {
    parseCredentialAlias(command.alias)
    if (!Number.isSafeInteger(command.epoch) || (command.epoch as number) < 0) throw new Error('Invalid credential resource revision')
    if (command.type === 'saveCredential') parseCredentialValue(command.value)
    else if (typeof command.credentialId !== 'string' || !/^[a-f0-9-]{36}$/.test(command.credentialId)) throw new Error('Invalid credential record identity')
  }
  if (command.type === 'saveVariable' || command.type === 'removeVariable') parseVariable({ name: command.name as string, value: command.type === 'saveVariable' ? command.value as string : '', revision: command.revision as number })
  return structuredClone(command) as InternalResourceCommand
}
export function parseResourceState(value: unknown): ResourceState {
  if (!value || typeof value !== 'object') throw new Error('Invalid resource response')
  const state = value as ResourceState
  if (!Array.isArray(state.resources) || !Number.isSafeInteger(state.epoch) || state.epoch < 0) throw new Error('Invalid resource state')
  if (state.variables !== undefined) {
    if (!Array.isArray(state.variables) || state.variables.length > 32) throw new Error('Invalid pod variables')
    for (const variable of state.variables) parseVariable(variable)
  }
  for (const resource of state.resources) {
    parseResourceCommand({ type: 'revoke', podId: resource.podId, id: resource.id, revision: resource.revision })
    if (typeof resource.name !== 'string' || !['reference', 'tool', 'connection', 'credential'].includes(resource.kind) || !['ready', 'missing', 'expired', 'revoked', 'refreshRequired'].includes(resource.state) || !resource.configuration || typeof resource.configuration !== 'object') throw new Error('Invalid resource record')
    if (resource.kind === 'credential') {
      parseCredentialAlias(resource.configuration.alias)
      if (Object.keys(resource.configuration).some(key => !['alias', 'credentialId'].includes(key)) || typeof resource.configuration.credentialId !== 'string' || !/^[a-f0-9-]{36}$/.test(resource.configuration.credentialId)) throw new Error('Invalid credential resource metadata')
    }
  }
  if (state.snapshot && (typeof state.snapshot.id !== 'string' || !Array.isArray(state.snapshot.files) || state.snapshot.files.some(file => typeof file.id !== 'string' || !/^[a-f0-9]{64}$/.test(file.hash) || !Number.isSafeInteger(file.size) || file.size < 0))) throw new Error('Invalid snapshot result')
  return state
}
