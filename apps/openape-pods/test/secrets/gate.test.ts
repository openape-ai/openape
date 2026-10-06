// @vitest-environment node
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { generateConsumerKey, openBox, sealBox } from '../../src/main/secrets/box'
import { SecretsGate } from '../../src/main/secrets/gate'
import type { ConsumerRecord } from '../../src/main/secrets/gate'
import type { SecretRequestRow } from '../../src/contracts/secrets'

/**
 * The desktop side of OpenApe Secrets against a synthetic service that reproduces the real
 * endpoints (exchange, consumers, requests, collect, cancel) and the real envelope format. The
 * production service needs the identity provider for the token exchange, so the endpoints are
 * replayed here with the same status codes and shapes as `apps/openape-secrets/server/api`.
 */
interface ServiceRequest { id: string, status: 'requested' | 'filled' | 'fetched' | 'cancelled' | 'expired', consumerId: string, fieldName: string, purpose: string, box: Record<string, string> | null, expiresAt: number }
let server: Server; let origin: string
const service = { tokens: 0, consumers: [] as { id: string, publicKeyJwk: JsonWebKey }[], requests: [] as ServiceRequest[], calls: [] as string[] }
beforeEach(async () => {
  service.tokens = 0; service.consumers = []; service.requests = []; service.calls = []
  server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const reply = (status: number, value: unknown) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)) }
      service.calls.push(`${request.method} ${request.url}`)
      if (request.url === '/api/cli/exchange') { const parsed = JSON.parse(body) as { subject_token?: string }; if (parsed.subject_token !== 'owner-idp-token') return reply(401, { title: 'bad subject' }); service.tokens++; return reply(200, { access_token: `service-token-${service.tokens}`, token_type: 'Bearer', expires_at: Math.floor(Date.now() / 1000) + 3600 }) }
      if (request.headers.authorization !== `Bearer service-token-${service.tokens}`) return reply(401, { title: 'unauthenticated' })
      if (request.url === '/api/consumers' && request.method === 'POST') { const parsed = JSON.parse(body) as { name: string, publicKeyJwk: JsonWebKey }; if ('d' in parsed.publicKeyJwk) return reply(400, { title: 'private key refused' }); const id = `01CONSUMER${service.consumers.length}`; service.consumers.push({ id, publicKeyJwk: parsed.publicKeyJwk }); return reply(201, { id, name: parsed.name, allowed_requesters: [], created_at: 1 }) }
      if (request.url === '/api/requests' && request.method === 'POST') { const parsed = JSON.parse(body) as { consumerId: string, fieldName: string, purpose: string, ttlSec: number }; if (!service.consumers.some(item => item.id === parsed.consumerId)) return reply(404, { title: 'Consumer not found' }); const row: ServiceRequest = { id: `01REQ${service.requests.length}`, status: 'requested', consumerId: parsed.consumerId, fieldName: parsed.fieldName, purpose: parsed.purpose, box: null, expiresAt: Math.floor(Date.now() / 1000) + parsed.ttlSec }; service.requests.push(row); return reply(201, { id: row.id, status: row.status, field_name: row.fieldName, purpose: row.purpose, expires_at: row.expiresAt }) }
      const match = /^\/api\/requests\/([^/]+)(\/collect|\/cancel)?$/.exec(request.url ?? '')
      const row = match && service.requests.find(item => item.id === match[1])
      if (!match || !row) return reply(404, { title: 'Request not found' })
      if (!match[2]) return reply(200, { id: row.id, status: row.status, field_name: row.fieldName, purpose: row.purpose, expires_at: row.expiresAt })
      if (match[2] === '/cancel') { if (row.status !== 'requested') return reply(409, { title: `Request is already ${row.status}` }); row.status = 'cancelled'; return reply(200, { id: row.id, status: row.status }) }
      if (row.status === 'fetched') return reply(410, { title: 'Already collected' })
      if (row.status !== 'filled') return reply(409, { title: `Request is ${row.status}, nothing to collect` })
      const box = row.box; row.status = 'fetched'; row.box = null
      return reply(200, { id: row.id, field_name: row.fieldName, box })
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }; origin = `http://127.0.0.1:${address.port}`
})
afterEach(() => new Promise<void>(resolve => server.close(() => resolve())))

/** The owner's browser: reads the consumer key from the service and seals the value against it. */
async function fill(id: string, value: string) {
  const row = service.requests.find(item => item.id === id)!
  row.box = await sealBox(service.consumers.find(item => item.id === row.consumerId)!.publicKeyJwk, value) as unknown as Record<string, string>
  row.status = 'filled'
}
const podId = '00000000-0000-4000-8000-000000000001'
function gate(now: () => number = Date.now) {
  let consumer: ConsumerRecord | null = null; const rows: SecretRequestRow[] = []; const stored: { podId: string, alias: string, value: string }[] = []
  const instance = new SecretsGate({
    origin, fetch: (input, init) => fetch(input, init), now,
    ownerToken: async () => 'owner-idp-token',
    consumer: { load: async () => consumer, save: async (record) => { consumer = record }, erase: async () => { consumer = null } },
    rows: { list: async () => rows.map(row => ({ ...row })), record: async (row) => { rows.push({ ...row }) }, update: async (id, patch) => { Object.assign(rows.find(row => row.id === id)!, patch) } },
    store: async (podId, alias, value) => { stored.push({ podId, alias, value }) },
  })
  return { instance, rows, stored, consumer: () => consumer }
}

it('registers this Mac once, raises a request as the owner, collects the envelope once and stores the alias', async () => {
  const { instance, rows, stored, consumer } = gate()
  const row = await instance.request(podId, 'telegram_bot_token', 'Send PR reports to the team chat')
  expect(row).toMatchObject({ podId, alias: 'telegram_bot_token', purpose: 'Send PR reports to the team chat', status: 'requested', error: null })
  expect(consumer()?.consumerId).toBe('01CONSUMER0')
  expect(consumer()?.privateJwk.d).toBeTypeOf('string')
  expect(service.consumers[0]!.publicKeyJwk).not.toHaveProperty('d')
  expect(service.requests[0]).toMatchObject({ fieldName: 'telegram_bot_token', purpose: 'Send PR reports to the team chat', status: 'requested' })
  expect(JSON.stringify(rows) + JSON.stringify(service.requests)).not.toContain('7391:AAH')

  await instance.poll()
  expect(rows[0]!.status).toBe('requested'); expect(stored).toEqual([])
  await fill(row.id, '7391:AAH-secret-value')
  await instance.poll()
  expect(stored).toEqual([{ podId, alias: 'telegram_bot_token', value: '7391:AAH-secret-value' }])
  expect(rows[0]).toMatchObject({ status: 'collected', error: null })
  expect(service.requests[0]).toMatchObject({ status: 'fetched', box: null })
  // A second request reuses the consumer and the service token; nothing is collected twice.
  await instance.request(podId, 'reports_publisher_key', '')
  await instance.poll()
  expect(service.consumers).toHaveLength(1); expect(service.tokens).toBe(1); expect(stored).toHaveLength(1)
  expect(service.calls.filter(call => call.endsWith('/collect'))).toHaveLength(1)
  expect((await instance.view())).toMatchObject({ origin, consumer: { id: '01CONSUMER0' }, requests: [expect.objectContaining({ status: 'collected' }), expect.objectContaining({ status: 'requested' })] })
})

it('closes cancelled, lapsed and foreign-collected requests without storing anything', async () => {
  let at = Date.now(); const { instance, rows, stored } = gate(() => at)
  const cancelled = await instance.request(podId, 'a_key', 'cancelled by the owner')
  const lapsed = await instance.request(podId, 'b_key', 'never filled')
  const foreign = await instance.request(podId, 'c_key', 'collected elsewhere')
  await instance.cancel(cancelled.id)
  expect(service.requests[0]!.status).toBe('cancelled'); expect(rows[0]!.status).toBe('expired')
  await fill(foreign.id, 'gone'); service.requests[2]!.status = 'fetched'; service.requests[2]!.box = null
  at += 86400 * 1000 + 1
  await instance.poll()
  expect(rows.map(row => row.status)).toEqual(['expired', 'expired', 'failed'])
  expect(rows[2]!.error).toBe('The envelope was collected elsewhere')
  expect(stored).toEqual([]); expect(lapsed.status).toBe('requested')
})

it('marks a request failed when the envelope cannot be opened and keeps the row for the owner', async () => {
  const { instance, rows, stored } = gate()
  const row = await instance.request(podId, 'd_key', 'wrong key')
  const other = await generateConsumerKey()
  service.consumers[0]!.publicKeyJwk = other.publicJwk
  await fill(row.id, 'sealed against another key')
  await instance.poll()
  expect(rows[0]!.status).toBe('failed'); expect(rows[0]!.error).toBeTruthy(); expect(stored).toEqual([])
  expect(service.requests[0]!.status).toBe('fetched')
})

it('refuses a sign-in the service rejects and never registers a consumer', async () => {
  const { instance, consumer } = gate()
  const rejected = new SecretsGate({ origin, fetch: (input, init) => fetch(input, init), ownerToken: async () => 'someone-else', consumer: { load: async () => null, save: async () => {}, erase: async () => {} }, rows: { list: async () => [], record: async () => {}, update: async () => {} }, store: async () => {} })
  await expect(rejected.request(podId, 'e_key', '')).rejects.toThrow('OpenApe Secrets sign-in failed (401)')
  expect(service.consumers).toEqual([])
  await instance.revoke(); expect(consumer()).toBeNull()
})

it('opens only what was sealed against the key', async () => {
  const keys = await generateConsumerKey()
  const box = await sealBox(keys.publicJwk, 'value with ünïcode')
  expect(await openBox(keys.privateJwk, box)).toBe('value with ünïcode')
  await expect(openBox((await generateConsumerKey()).privateJwk, box)).rejects.toThrow()
})
