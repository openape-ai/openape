import { dataFields, dataIdentity, dataKey, dataRevision, publicConfiguration } from './network-data'
import type { NetworkDefinition } from './networks'
import type { PayloadScalar } from './network-payload'

export interface NetworkValue { name: string, kind: 'public' | 'secret-reference', origin: 'definition' | 'composition', value: PayloadScalar }
export interface NetworkMemberView { diagnostic?: string, podId: string, name: string, lifecycle: 'active' | 'paused' | 'archived', capabilities: string[], triggers: string[], values: NetworkValue[], resourcesMore: boolean, resources: { name: string, kind: string, state: string }[] }
export interface NetworkFailure { runId: string, generation: number, podId: string, kind: 'transient' | 'invalid' | 'uncertain' | 'exhausted' | 'timeout' | 'quota' | 'recovery', reason: string, inspectedAt: number | null, conflict: string | null, effects: { key: string, attempt: number, sequence: number, state: string }[], effectsMore: boolean }
export interface NetworkDetails { definition: NetworkDefinition, members: NetworkMemberView[], failures: NetworkFailure[], collectionsMore: boolean, collections: { id: string, name: string, version: number }[] }
export interface NetworkTracePage { events: { id: number, caseId: string | null, runId: string | null, kind: string, body: string, truncated: boolean, at: number }[], before: number | null }
export interface NetworkDataPage { collectionId: string, records: { key: string, revision: number, schemaVersion: number, body: string | null, truncated: boolean, deleted: boolean, at: number }[], after: string | null }
export interface NetworkSetup { fingerprint: string, groupId: string, members: NetworkMemberView[] }
export type NetworkReadCommand =
  | { type: 'setup', groupId: string, podIds: string[] }
  | { type: 'detail', id: string, revision: number }
  | { type: 'trace', id: string, revision: number, before: number | null, caseId: string | null }
  | { type: 'records', id: string, revision: number, collectionId: string, after: string | null }

export function networkSharedValues(value: unknown): Record<string, PayloadScalar> {
  const input = dataFields(value, Object.keys(value && typeof value === 'object' ? value : {}))
  if (Object.keys(input).length > 32) throw new Error('Network configuration exceeds 32 fields')
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [dataKey(key), publicConfiguration(value)]))
}

export function parseNetworkRead(value: unknown): NetworkReadCommand | null {
  const input = dataFields(value, ['type'], ['id', 'revision', 'groupId', 'podIds', 'before', 'caseId', 'collectionId', 'after'])
  if (input.type === 'setup') {
    dataFields(input, ['type', 'groupId', 'podIds'])
    if (!Array.isArray(input.podIds) || !input.podIds.length || input.podIds.length > 64 || new Set(input.podIds).size !== input.podIds.length) throw new Error('Invalid network setup members')
    return { type: 'setup', groupId: dataIdentity(input.groupId), podIds: input.podIds.map(dataIdentity) }
  }
  if (!['detail', 'trace', 'records'].includes(String(input.type))) return null
  const revision = dataRevision(input.revision)
  if (!revision) throw new Error('Invalid network revision')
  const common = { id: dataIdentity(input.id), revision }
  if (input.type === 'detail') { dataFields(input, ['type', 'id', 'revision']); return { type: 'detail', ...common } }
  if (input.type === 'trace') {
    dataFields(input, ['type', 'id', 'revision', 'before', 'caseId'])
    return { type: 'trace', ...common, before: input.before === null ? null : dataRevision(input.before), caseId: input.caseId === null ? null : dataIdentity(input.caseId) }
  }
  dataFields(input, ['type', 'id', 'revision', 'collectionId', 'after'])
  return { type: 'records', ...common, collectionId: dataIdentity(input.collectionId), after: input.after === null ? null : dataKey(input.after) }
}

export function parseNetworkMemberView(value: unknown): NetworkMemberView {
  const input = dataFields(value, ['podId', 'name', 'lifecycle', 'capabilities', 'triggers', 'values', 'resources', 'resourcesMore'], ['diagnostic'])
  if (input.diagnostic !== undefined && (typeof input.diagnostic !== 'string' || input.diagnostic.length > 10000)) throw new Error('Invalid network member view')
  dataIdentity(input.podId)
  if (typeof input.resourcesMore !== 'boolean') throw new Error('Invalid network resource summary')
  if (typeof input.name !== 'string' || input.name.length > 120 || !['active', 'paused', 'archived'].includes(String(input.lifecycle))) throw new Error('Invalid network member view')
  for (const key of ['capabilities', 'triggers'] as const) {
    if (!Array.isArray(input[key]) || input[key].length > 256 || input[key].some(item => typeof item !== 'string' || item.length > 2048)) throw new Error('Invalid network member view')
  }
  if (!Array.isArray(input.values) || input.values.length > 32 || !Array.isArray(input.resources) || input.resources.length > 256) throw new Error('Invalid network member view')
  for (const value of input.values) {
    const field = dataFields(value, ['name', 'kind', 'origin', 'value']); dataKey(field.name)
    if (!['public', 'secret-reference'].includes(String(field.kind)) || !['definition', 'composition'].includes(String(field.origin)) || (field.kind === 'secret-reference' && field.value !== null)) throw new Error('Invalid network configuration view')
    publicConfiguration(field.value)
  }
  for (const value of input.resources) {
    const resource = dataFields(value, ['name', 'kind', 'state'])
    if (Object.values(resource).some(item => typeof item !== 'string' || item.length > 2048)) throw new Error('Invalid network resource summary')
  }
  return input as unknown as NetworkMemberView
}
