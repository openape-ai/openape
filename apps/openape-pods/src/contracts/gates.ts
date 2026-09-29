import { createHash } from 'node:crypto'

export const gateAudience = 'pods-graph-gate'
export const gateLimits = { batchItems: 30, expiryMs: 12 * 60 * 60 * 1000, pendingBatches: 4, summaryLength: 4096 } as const
export type GateBatchState = 'preparing' | 'pending' | 'consuming' | 'approved' | 'denied' | 'expired' | 'superseded' | 'unknown'
export interface GateBatchItem { itemId: string, key: string, hash: string, title: string, excluded: boolean, emittedId: string | null }
export interface GateBatchView { id: string, workflowId: string, gate: string, podId: string, state: GateBatchState, url: string | null, expiresAt: number, error: string | null, items: { itemId: string, key: string, title: string, excluded: boolean }[] }
export interface GateHeldItem { itemId: string, workflowId: string, gate: string, key: string, title: string }
/** What the owner approves: the consumer Pod, the expiry and a digest over every item of the batch. */
export interface GateManifest { version: 1, id: string, workflowId: string, gate: string, title: string, podId: string, expiresAt: number, digest: string, items: { key: string, hash: string, title: string }[] }
export interface GateCoverage { manifest: GateManifest, grantId: string, items: { key: string, data: Record<string, unknown> }[] }

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
export const payloadHash = (data: Record<string, unknown>): string => sha256(JSON.stringify(data))
/** Binds the keys and the payloads of a batch, independent of their order. */
export function gateDigest(items: { key: string, hash: string }[]): string {
  return sha256(items.map(item => `${item.key}\n${item.hash}`).sort().join('\n'))
}
/** Mail content is data: the title is shortened, single-line text and nothing else. */
export function itemTitle(key: string, data: Record<string, unknown>): string {
  const parts = [data.subject, data.sender].filter((part): part is string => typeof part === 'string' && !!part.trim())
  // eslint-disable-next-line no-control-regex
  return (parts.length ? parts.join(' · ') : key).replace(/[\u0000-\u001F\u007F]+/g, ' ').trim().slice(0, 120)
}
export function parseGateManifest(value: unknown): GateManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid gate batch')
  const manifest = value as GateManifest
  if (Object.keys(manifest).some(key => !['version', 'id', 'workflowId', 'gate', 'title', 'podId', 'expiresAt', 'digest', 'items'].includes(key)) || manifest.version !== 1 || ![manifest.id, manifest.workflowId, manifest.podId].every(uuid) || typeof manifest.gate !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(manifest.gate) || typeof manifest.title !== 'string' || !manifest.title.trim() || manifest.title.length > 60 || !Number.isSafeInteger(manifest.expiresAt) || !Array.isArray(manifest.items) || !manifest.items.length || manifest.items.length > gateLimits.batchItems) throw new Error('Invalid gate batch')
  for (const item of manifest.items) {
    if (!item || Object.keys(item).some(key => !['key', 'hash', 'title'].includes(key)) || typeof item.key !== 'string' || !item.key || item.key.length > 200 || typeof item.hash !== 'string' || !/^[a-f0-9]{64}$/.test(item.hash) || typeof item.title !== 'string' || item.title.length > 120) throw new Error('Invalid gate batch')
  }
  if (new Set(manifest.items.map(item => item.key)).size !== manifest.items.length || manifest.digest !== gateDigest(manifest.items)) throw new Error('Gate batch does not match its digest')
  return structuredClone(manifest)
}
export function gateCommand(manifest: GateManifest): string[] {
  const { items, title: _title, ...batch } = manifest
  return ['pods-graph-gate', 'approve', JSON.stringify({ ...batch, count: items.length })]
}
export function gateSummary(manifest: GateManifest): string {
  const lines = [`${manifest.title}: ${manifest.items.length} Einträge freigeben`, `Gültig bis: ${new Date(manifest.expiresAt).toLocaleString('de-AT', { timeZone: 'Europe/Vienna' })} (Wien)`, 'Die Freigabe gilt genau für diese Einträge. Geänderte Einträge werden übersprungen.', '']
  manifest.items.forEach((item, index) => lines.push(`${index + 1}. ${item.title}`))
  return lines.join('\n')
}
/** The items of a consumed batch, checked against the manifest the owner approved. */
export function parseGateCoverage(value: unknown): GateCoverage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid gate coverage')
  const coverage = value as GateCoverage
  if (Object.keys(coverage).some(key => !['manifest', 'grantId', 'items'].includes(key)) || typeof coverage.grantId !== 'string' || !/^[\w-]{1,128}$/.test(coverage.grantId) || !Array.isArray(coverage.items) || coverage.items.length > gateLimits.batchItems) throw new Error('Invalid gate coverage')
  const manifest = parseGateManifest(coverage.manifest)
  const items = coverage.items.map((item) => {
    if (!item || Object.keys(item).some(key => !['key', 'data'].includes(key)) || typeof item.key !== 'string' || !item.data || typeof item.data !== 'object' || Array.isArray(item.data)) throw new Error('Invalid gate coverage')
    if (!manifest.items.some(approved => approved.key === item.key && approved.hash === payloadHash(item.data))) throw new Error('Item is not part of the approved batch')
    return { key: item.key, data: item.data }
  })
  return { manifest, grantId: coverage.grantId, items }
}
