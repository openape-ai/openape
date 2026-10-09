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
/** Approved inputs of one batch; each input carries its own consumed once-grant. */
export interface NetworkGateCoverage { manifest: NetworkGateManifest, grantId: string, items: { deliveryId: string, eventId: string, key: string, grantId: string, data: Record<string, unknown> }[] }
export { parseNetworkGateView } from './network-gate-view'
export type { NetworkGateView } from './network-gate-view'

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

/** The grant of one input binds the frozen batch authority and exactly this input. */
export function networkGateItemCommand(manifest: NetworkGateManifest, item: NetworkGateItem): string[] {
  const { items, title: _title, owner: _owner, ...authority } = manifest
  const { deliveryId, eventId, generation, hash, channel } = item
  return ['pods-graph-gate', 'approve', canonicalNetworkJson({ ...authority, count: items.length, item: { deliveryId, eventId, generation, hash, channel } })]
}

export const networkGateItemSummary = (item: NetworkGateItem): string => item.title || item.key

export function parseNetworkGateCoverage(value: unknown): NetworkGateCoverage {
  const input = networkDataObject(value)
  if (Object.keys(input).some(key => !['manifest', 'grantId', 'items'].includes(key)) || typeof input.grantId !== 'string' || !/^[\w-]{1,128}$/.test(input.grantId) || !Array.isArray(input.items) || !input.items.length || input.items.length > gateLimits.batchItems) throw new Error('Invalid network gate coverage')
  const manifest = parseNetworkGateManifest(input.manifest)
  const items = input.items.map((value) => {
    const item = networkDataObject(value)
    if (Object.keys(item).some(key => !['deliveryId', 'eventId', 'key', 'grantId', 'data'].includes(key)) || typeof item.grantId !== 'string' || !/^[\w-]{1,128}$/.test(item.grantId)) throw new Error('Invalid network gate coverage item')
    const data = networkDataObject(item.data)
    if (!manifest.items.some(approved => approved.deliveryId === item.deliveryId && approved.eventId === item.eventId && approved.key === item.key && approved.hash === networkGatePayloadHash(data))) throw new Error('Input is not covered by this network approval')
    return { deliveryId: item.deliveryId as string, eventId: item.eventId as string, key: item.key as string, grantId: item.grantId as string, data }
  })
  if (new Set(items.map(item => item.deliveryId)).size !== items.length) throw new Error('Duplicate network gate coverage item')
  return { manifest, grantId: input.grantId, items }
}

/** A finished batch whose item grants the desktop releases at the IdP; only grants the owner approved as always are still active there. */
export interface NetworkGateRelease { taskId: string, podId: string, owner: Owner, manifest: NetworkGateManifest, grants: { key: string, id: string }[] }
export function parseNetworkGateReleases(value: unknown): NetworkGateRelease[] {
  if (!Array.isArray(value) || value.length > 16) throw new Error('Invalid network gate release list')
  return value.map((entry) => {
    const input = networkDataObject(entry)
    if (Object.keys(input).some(key => !['taskId', 'podId', 'owner', 'manifest', 'grants'].includes(key))) throw new Error('Invalid network gate release fields')
    const manifest = parseNetworkGateManifest(input.manifest)
    if (input.taskId !== manifest.id || input.podId !== manifest.podId || !Array.isArray(input.grants) || !input.grants.length || input.grants.length > manifest.items.length) throw new Error('Invalid network gate release')
    const grants = input.grants.map((value) => {
      const grant = networkDataObject(value)
      if (Object.keys(grant).length !== 2 || !manifest.items.some(item => item.deliveryId === grant.key) || typeof grant.id !== 'string' || !/^[\w-]{1,128}$/.test(grant.id)) throw new Error('Invalid network gate release grant')
      return { key: grant.key as string, id: grant.id }
    })
    return { taskId: manifest.id, podId: manifest.podId, owner: parseOwner(input.owner), manifest, grants }
  })
}
