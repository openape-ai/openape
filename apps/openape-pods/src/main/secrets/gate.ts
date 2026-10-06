import { hostname } from 'node:os'
import type { SecretRequestRow, SecretsView } from '../../contracts/secrets'
import { generateConsumerKey, isSealedBox, openBox } from './box'

/**
 * The desktop's side of OpenApe Secrets. Everything that touches the network, the key or the
 * stored rows arrives injected, so the whole flow runs against a synthetic service in tests:
 * register this Mac as consumer once, raise a request as the owner, poll until it is filled,
 * collect the envelope once, open it locally and hand the value to the existing credential path.
 */
export interface ConsumerRecord { consumerId: string, privateJwk: JsonWebKey, registeredAt: number }
export interface SecretsGateDependencies {
  origin: string
  fetch: typeof fetch
  /** The owner's identity token at the identity provider; exchanged here for a service token. */
  ownerToken: (signal: AbortSignal) => Promise<string>
  consumer: { load: () => Promise<ConsumerRecord | null>, save: (record: ConsumerRecord) => Promise<void>, erase: () => Promise<void> }
  rows: { list: () => Promise<SecretRequestRow[]>, record: (row: SecretRequestRow) => Promise<void>, update: (id: string, patch: Partial<Pick<SecretRequestRow, 'status' | 'error' | 'updatedAt'>>) => Promise<void> }
  /** The existing credential path: encrypted on this Mac, only for this Pod, readable only by its script. */
  store: (podId: string, alias: string, value: string) => Promise<void>
  now?: () => number
}
export const secretRequestTtlSeconds = 86400
export const secretsPollMs = 60000

export class SecretsGate {
  private token: { value: string, expiresAt: number } | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private polling: Promise<void> | null = null
  constructor(private readonly deps: SecretsGateDependencies) {}
  private now(): number { return this.deps.now?.() ?? Date.now() }

  private async bearer(signal: AbortSignal): Promise<string> {
    if (this.token && this.token.expiresAt - 60000 > this.now()) return this.token.value
    const response = await this.deps.fetch(`${this.deps.origin}/api/cli/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject_token: await this.deps.ownerToken(signal) }), redirect: 'error', signal })
    if (!response.ok) throw new Error(`OpenApe Secrets sign-in failed (${response.status})`)
    const reply = await response.json() as { access_token?: unknown, expires_at?: unknown, expires_in?: unknown }
    if (typeof reply.access_token !== 'string' || !reply.access_token) throw new Error('OpenApe Secrets sign-in returned no token')
    const expiresAt = typeof reply.expires_at === 'number' ? reply.expires_at * 1000 : typeof reply.expires_in === 'number' ? this.now() + reply.expires_in * 1000 : this.now() + 3600000
    this.token = { value: reply.access_token, expiresAt }
    return reply.access_token
  }

  private async call(method: 'GET' | 'POST', path: string, body: unknown, signal: AbortSignal): Promise<{ status: number, body: Record<string, unknown> | null }> {
    const token = await this.bearer(signal)
    const response = await this.deps.fetch(`${this.deps.origin}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal })
    const text = await response.text()
    let parsed: Record<string, unknown> | null = null
    try { parsed = text ? JSON.parse(text) as Record<string, unknown> : null }
    catch { parsed = null }
    return { status: response.status, body: parsed }
  }

  /** The first use registers this Mac; the private key stays in the encrypted store. */
  async consumer(signal: AbortSignal): Promise<ConsumerRecord> {
    const existing = await this.deps.consumer.load()
    if (existing) return existing
    const keys = await generateConsumerKey()
    const reply = await this.call('POST', '/api/consumers', { name: `OpenApe Pods on ${hostname()}`, publicKeyJwk: keys.publicJwk, allowedRequesters: [] }, signal)
    if (reply.status !== 201 || typeof reply.body?.id !== 'string') throw new Error(`OpenApe Secrets refused the consumer registration (${reply.status})`)
    const record = { consumerId: reply.body.id, privateJwk: keys.privateJwk, registeredAt: this.now() }
    await this.deps.consumer.save(record)
    return record
  }

  async request(podId: string, alias: string, purpose: string, signal = AbortSignal.timeout(30000)): Promise<SecretRequestRow> {
    const consumer = await this.consumer(signal)
    const reply = await this.call('POST', '/api/requests', { consumerId: consumer.consumerId, fieldName: alias, purpose, ttlSec: secretRequestTtlSeconds }, signal)
    if (reply.status !== 201 || typeof reply.body?.id !== 'string') throw new Error(`OpenApe Secrets refused the request (${reply.status})`)
    const at = this.now()
    const row: SecretRequestRow = { id: reply.body.id, podId, alias, purpose, status: 'requested', expiresAt: typeof reply.body.expires_at === 'number' ? reply.body.expires_at * 1000 : at + secretRequestTtlSeconds * 1000, createdAt: at, updatedAt: at, error: null }
    await this.deps.rows.record(row)
    return row
  }

  async cancel(id: string, signal = AbortSignal.timeout(30000)): Promise<void> {
    const reply = await this.call('POST', `/api/requests/${id}/cancel`, {}, signal)
    if (reply.status >= 400 && reply.status !== 404 && reply.status !== 409) throw new Error(`OpenApe Secrets refused the cancellation (${reply.status})`)
    await this.deps.rows.update(id, { status: 'expired', updatedAt: this.now() })
  }

  /** One round: every open request is read; a filled one is collected once and stored, a dead one closed. */
  async poll(signal = AbortSignal.timeout(30000)): Promise<void> {
    if (this.polling) return this.polling
    this.polling = (async () => {
      const open = (await this.deps.rows.list()).filter(row => row.status === 'requested' || row.status === 'filled')
      if (!open.length) return
      const consumer = await this.deps.consumer.load()
      for (const row of open) {
        try {
          const view = await this.call('GET', `/api/requests/${row.id}`, undefined, signal)
          const status = view.body?.status
          if (view.status === 404 || status === 'cancelled' || status === 'expired' || (status === 'requested' && this.now() >= row.expiresAt)) { await this.deps.rows.update(row.id, { status: 'expired', updatedAt: this.now() }); continue }
          if (status === 'fetched' && row.status !== 'collected') { await this.deps.rows.update(row.id, { status: 'failed', error: 'The envelope was collected elsewhere', updatedAt: this.now() }); continue }
          if (status !== 'filled') continue
          if (!consumer) throw new Error('The consumer key of this Mac is missing; the envelope cannot be opened')
          if (row.status !== 'filled') await this.deps.rows.update(row.id, { status: 'filled', updatedAt: this.now() })
          const collected = await this.call('POST', `/api/requests/${row.id}/collect`, {}, signal)
          if (collected.status !== 200 || !isSealedBox(collected.body?.box)) throw new Error(`OpenApe Secrets did not hand over the envelope (${collected.status})`)
          const value = await openBox(consumer.privateJwk, collected.body!.box as never)
          await this.deps.store(row.podId, row.alias, value)
          await this.deps.rows.update(row.id, { status: 'collected', error: null, updatedAt: this.now() })
        }
        catch (error) {
          await this.deps.rows.update(row.id, { status: 'failed', error: error instanceof Error ? error.message : String(error), updatedAt: this.now() })
        }
      }
    })().finally(() => { this.polling = null })
    return this.polling
  }

  start(intervalMs = secretsPollMs): void {
    if (this.timer) return
    this.timer = setInterval(() => { void this.poll().catch(() => {}) }, intervalMs)
  }

  async stop(): Promise<void> { if (this.timer) clearInterval(this.timer); this.timer = null; await this.polling }

  async revoke(): Promise<void> { await this.deps.consumer.erase(); this.token = null }

  async view(): Promise<SecretsView> {
    const consumer = await this.deps.consumer.load()
    return { origin: this.deps.origin, consumer: consumer ? { id: consumer.consumerId, registeredAt: consumer.registeredAt } : null, requests: await this.deps.rows.list() }
  }
}
