import { parseGraphChannels } from './graphs'
import { createHash } from 'node:crypto'
import { parseOwner } from '@openape/pods-protocol'
import type { Owner } from '@openape/pods-protocol'
import { gateLimits } from './gates'
import { canonicalNetworkJson } from './network-json'
import { networkDataObject } from './network-payload'

export interface NetworkGateItem { deliveryId: string, eventId: string, generation: number, key: string, hash: string, channel: string, title: string }
export interface NetworkGateManifest {
  version: 2 | 3
  dataPin?: string
  id: string
  networkId: string
  networkRevision: number
  gate: string
  title: string
  podId: string
  owner: Owner
  restoreNonce: string
  activationEpoch: number
  definitionId: string
  definitionVersion: number
  bindingRevision: number
  assignmentRevision: number
  resourceEpoch: number
  scriptHash: string
  expiresAt: number
  actionHash: string
  digest: string
  items: NetworkGateItem[]
}
export interface NetworkGateCoverage { manifest: NetworkGateManifest, grantId: string, items: { deliveryId: string, eventId: string, key: string, data: Record<string, unknown> }[] }
export interface NetworkGateView { id: string, networkId: string, gate: string, podId: string, generation: number, state: string, expiresAt: number, url: string | null, error: string | null, items: { deliveryId: string, title: string, outcome: string }[] }

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
const sha256 = (value: unknown): string => createHash('sha256').update(canonicalNetworkJson(value)).digest('hex')
export const networkGatePayloadHash = (data: Record<string, unknown>): string => sha256(data)

export function networkGateActionHash(manifest: Omit<NetworkGateManifest, 'digest' | 'actionHash'>): string {
  return sha256({ ...(manifest.version === 3 ? { dataPin: manifest.dataPin } : {}), operation: 'network.consumer', podId: manifest.podId, scriptHash: manifest.scriptHash, definitionId: manifest.definitionId, definitionVersion: manifest.definitionVersion, bindingRevision: manifest.bindingRevision, assignmentRevision: manifest.assignmentRevision, resourceEpoch: manifest.resourceEpoch, inputs: manifest.items.map(({ deliveryId, eventId, generation, hash, channel }) => ({ deliveryId, eventId, generation, hash, channel })) })
}

export function networkGateDigest(manifest: Omit<NetworkGateManifest, 'digest'>): string { return sha256(manifest) }

export function parseNetworkGateManifest(value: unknown): NetworkGateManifest {
  const input = networkDataObject(value)
  const names = ['version', 'id', 'networkId', 'networkRevision', 'gate', 'title', 'podId', 'owner', 'restoreNonce', 'activationEpoch', 'definitionId', 'definitionVersion', 'bindingRevision', 'assignmentRevision', 'resourceEpoch', 'scriptHash', 'expiresAt', 'actionHash', 'digest', 'items', ...(input.version === 3 ? ['dataPin'] : [])]
  if (Object.keys(input).some(key => !names.includes(key)) || names.some(key => !Object.hasOwn(input, key))) throw new Error('Invalid network gate fields')
  if (![2, 3].includes(input.version as number) || (input.version === 3 && !hash(input.dataPin)) || ![input.id, input.networkId, input.podId, input.restoreNonce, input.definitionId].every(uuid) || ![input.networkRevision, input.activationEpoch, input.definitionVersion, input.bindingRevision, input.assignmentRevision, input.expiresAt].every(positive) || !Number.isSafeInteger(input.resourceEpoch) || Number(input.resourceEpoch) < 0 || ![input.scriptHash, input.actionHash, input.digest].every(hash)) throw new Error('Invalid network gate authority')
  if (typeof input.gate !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(input.gate) || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 60 || !Array.isArray(input.items) || !input.items.length || input.items.length > gateLimits.batchItems) throw new Error('Invalid network gate batch')
  const items = input.items.map((value): NetworkGateItem => {
    const item = networkDataObject(value)
    const names = ['deliveryId', 'eventId', 'generation', 'key', 'hash', 'channel', 'title']
    if (Object.keys(item).some(key => !names.includes(key)) || names.some(key => !Object.hasOwn(item, key)) || ![item.deliveryId, item.eventId].every(uuid) || !Number.isSafeInteger(item.generation) || Number(item.generation) < 0 || !hash(item.hash) || typeof item.key !== 'string' || !item.key || item.key.length > 200 || typeof item.channel !== 'string' || !/^[a-z][a-z0-9.-]{0,63}$/.test(item.channel) || typeof item.title !== 'string' || item.title.length > 120) throw new Error('Invalid network gate item')
    parseGraphChannels([{ name: item.channel, title: item.channel, fields: [] }])
    return item as unknown as NetworkGateItem
  })
  if (new Set(items.map(item => item.deliveryId)).size !== items.length || new Set(items.map(item => item.eventId)).size !== items.length) throw new Error('Duplicate network gate item')
  const manifest = { ...input, owner: parseOwner(input.owner), items } as unknown as NetworkGateManifest
  const { digest, actionHash, ...action } = manifest
  if (actionHash !== networkGateActionHash(action) || digest !== networkGateDigest({ ...action, actionHash })) throw new Error('Network gate batch differs from its frozen digest')
  return structuredClone(manifest)
}

export function networkGateCommand(manifest: NetworkGateManifest): string[] {
  const { items, title: _title, owner: _owner, ...authority } = manifest
  return ['pods-graph-gate', 'approve', canonicalNetworkJson({ ...authority, count: items.length })]
}

export function networkGateSummary(manifest: NetworkGateManifest): string {
  return [`${manifest.title}: approve ${manifest.items.length} items`, `Valid until: ${new Date(manifest.expiresAt).toISOString()}`, 'Approval covers this pinned consumer and these exact inputs. Changed inputs or authority cannot reuse it.', '', ...manifest.items.map((item, index) => `${index + 1}. ${item.title}`)].join('\n')
}

export function parseNetworkGateCoverage(value: unknown): NetworkGateCoverage {
  const input = networkDataObject(value)
  if (Object.keys(input).some(key => !['manifest', 'grantId', 'items'].includes(key)) || typeof input.grantId !== 'string' || !/^[\w-]{1,128}$/.test(input.grantId) || !Array.isArray(input.items) || !input.items.length || input.items.length > gateLimits.batchItems) throw new Error('Invalid network gate coverage')
  const manifest = parseNetworkGateManifest(input.manifest)
  const items = input.items.map((value) => {
    const item = networkDataObject(value)
    if (Object.keys(item).some(key => !['deliveryId', 'eventId', 'key', 'data'].includes(key))) throw new Error('Invalid network gate coverage item')
    const data = networkDataObject(item.data)
    if (!manifest.items.some(approved => approved.deliveryId === item.deliveryId && approved.eventId === item.eventId && approved.key === item.key && approved.hash === networkGatePayloadHash(data))) throw new Error('Input is not covered by this network approval')
    return { deliveryId: item.deliveryId as string, eventId: item.eventId as string, key: item.key as string, data }
  })
  if (new Set(items.map(item => item.deliveryId)).size !== items.length) throw new Error('Duplicate network gate coverage item')
  return { manifest, grantId: input.grantId, items }
}

export function parseNetworkGateView(value: unknown): NetworkGateView {
  const input = networkDataObject(value)
  if (Object.keys(input).some(key => !['id', 'networkId', 'gate', 'podId', 'generation', 'state', 'expiresAt', 'url', 'error', 'items'].includes(key)) || !uuid(input.id) || !uuid(input.networkId) || !uuid(input.podId) || typeof input.gate !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(input.gate) || !Number.isSafeInteger(input.generation) || Number(input.generation) < 1 || !Number.isSafeInteger(input.expiresAt) || Number(input.expiresAt) < 0 || !['preparing', 'pending', 'consuming', 'approved', 'denied', 'expired', 'superseded', 'unknown'].includes(input.state as string) || !Array.isArray(input.items) || !input.items.length || input.items.length > gateLimits.batchItems) throw new Error('Invalid network gate view')
  if (input.url !== null) {
    if (typeof input.url !== 'string' || input.url.length > 2048) throw new Error('Invalid network gate view URL')
    const url = new URL(input.url)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Invalid network gate view origin')
  }
  if (input.error !== null && (typeof input.error !== 'string' || input.error.length > 10000)) throw new Error('Invalid network gate view diagnostic')
  const items = input.items.map((value) => {
    const item = networkDataObject(value)
    if (Object.keys(item).some(key => !['deliveryId', 'title', 'outcome'].includes(key)) || !uuid(item.deliveryId) || typeof item.title !== 'string' || item.title.length > 120 || !['held', 'released', 'excluded', 'denied', 'expired', 'obsolete', 'unknown'].includes(item.outcome as string)) throw new Error('Invalid network gate view input')
    return { deliveryId: item.deliveryId, title: item.title, outcome: item.outcome as string }
  })
  if (new Set(items.map(item => item.deliveryId)).size !== items.length) throw new Error('Duplicate network gate view input')
  return { id: input.id, networkId: input.networkId, gate: input.gate, podId: input.podId, generation: input.generation as number, state: input.state as string, expiresAt: input.expiresAt as number, url: input.url as string | null, error: input.error as string | null, items }
}
