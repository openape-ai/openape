import { gateLimits } from './gate-limits'
import { networkDataObject } from './network-payload'

export interface NetworkGateView { id: string, networkId: string, gate: string, podId: string, generation: number, state: 'preparing' | 'pending' | 'consuming' | 'approved' | 'denied' | 'expired' | 'superseded' | 'unknown', expiresAt: number, url: string | null, error: string | null, items: { deliveryId: string, title: string, outcome: string }[] }

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)

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
  return { id: input.id, networkId: input.networkId, gate: input.gate, podId: input.podId, generation: input.generation as number, state: input.state as NetworkGateView['state'], expiresAt: input.expiresAt as number, url: input.url as string | null, error: input.error as string | null, items }
}
