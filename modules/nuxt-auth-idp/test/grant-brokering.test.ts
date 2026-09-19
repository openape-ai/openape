// @vitest-environment node
import type { BrokerConnection, BrokerRequest } from '@openape/core'
import type { H3Event } from 'h3'
import { generateKeyPair } from '@openape/core'
import { BROKER_REQUEST_TYPE, InMemoryGrantStore, signBrokerToken, verifyAuthzJWT } from '@openape/grants'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createApp, createError, createRouter, getHeader, toNodeListener } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const issuer = 'https://id.owner.test'
const broker = 'https://pods.provider.test'
const owner = 'human@owner.test'
const agent = 'agent@pods.provider.test'
let keys: Awaited<ReturnType<typeof generateKeyPair>>
let brokerKeys: Awaited<ReturnType<typeof generateKeyPair>>
let grantStore: InMemoryGrantStore
let connection: BrokerConnection
let seen: Set<string>
let server: ReturnType<typeof createServer>
let base: string
const notified = vi.fn()
function actor(event: H3Event) {
  const subject = getHeader(event, 'authorization')?.replace('Bearer ', '')
  if (subject === 'delegated-owner') return { sub: owner, act: 'human', delegation_grant: 'scoped-only' }
  return subject ? { sub: subject, act: subject === agent ? 'agent' : 'human', ...(subject === 'delegated' ? { delegation_grant: 'not-owner' } : {}) } : null
}
vi.mock('../src/runtime/server/utils/agent-auth', () => ({ tryBearerAuth: async (event: H3Event) => actor(event) }))
vi.mock('../src/runtime/server/utils/admin', () => ({ requireAuth: async (event: H3Event) => actor(event)?.sub ?? 'anonymous' }))
vi.mock('../src/runtime/server/utils/session', () => ({ getAppSession: async (event: H3Event) => ({ data: { userId: getHeader(event, 'x-session') } }) }))
vi.mock('../src/runtime/server/utils/grant-stores', () => ({ useGrantStores: () => ({ grantStore }) }))
vi.mock('../src/runtime/server/utils/grant-pending-hooks', () => ({ runGrantPendingHooks: (grant: unknown) => notified(grant) }))
vi.mock('../src/runtime/server/utils/stores', () => ({
  getIdpIssuer: () => issuer,
  useIdpStores: () => ({ keyStore: { getSigningKey: async () => ({ ...keys, kid: 'owner-key' }) }, userStore: { findByOwner: async () => [], findByApprover: async () => [], findByEmail: async (email: string) => email === owner || email === 'other@owner.test' ? { email, type: 'human', isActive: true } : null } }),
}))
vi.mock('../src/runtime/server/utils/broker-network', () => ({ discoverBroker: async () => ({ issuer: broker }), brokerVerificationKey: async () => brokerKeys.publicKey }))
vi.mock('../src/runtime/server/utils/broker-store', () => ({
  hasBrokerStore: () => true,
  useBrokerStore: () => ({
    recordToken: async () => {},
    getAgent: async () => null,
    getConnection: async (id: string) => connection.id === id ? connection : null,
    assertConnection: async () => { if (connection.status !== 'active') throw createError({ statusCode: 403 }) },
    acceptRequest: async (value: BrokerRequest) => {
      if (seen.has(value.jti)) throw createError({ statusCode: 409 })
      seen.add(value.jti)
      return connection
    },
  }),
}))
const mediated = (await import('../src/runtime/server/api/brokered-grants.post')).default
const approve = (await import('../src/runtime/server/api/grants/[id]/approve.post')).default
const list = (await import('../src/runtime/server/api/grants/index.get')).default
const detail = (await import('../src/runtime/server/api/grants/[id].get')).default
const directToken = (await import('../src/runtime/server/api/grants/[id]/token.post')).default

async function send(operation: 'create' | 'get' | 'token', input?: string, delta: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  const value = { iss: broker, aud: issuer, owner, connection_id: connection.id, sub: agent, key_id: 'agent-key', iat: now, exp: now + 60, jti: randomUUID(), operation, ...(operation === 'create' ? { request: { requester: agent, command: ['printf', 'fixture'], target_host: 'fixture', audience: 'shapes', grant_type: 'once' } } : { grant_id: input }), ...delta }
  const assertion = await signBrokerToken(value as BrokerRequest, brokerKeys.privateKey, 'broker-key', BROKER_REQUEST_TYPE)
  return fetch(`${base}/brokered`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assertion }) })
}
beforeEach(async () => {
  keys = await generateKeyPair(); brokerKeys = await generateKeyPair()
  grantStore = new InMemoryGrantStore(); seen = new Set(); notified.mockClear()
  connection = { id: randomUUID(), owner: { issuer, subject: owner }, broker_issuer: broker, agent_domain: 'pods.provider.test', status: 'active', created_at: 1 }
  const router = createRouter().get('/grants', list).post('/brokered', mediated).post('/grants/:id/approve', approve).post('/grants/:id/token', directToken).get('/grants/:id', detail)
  server = createServer(toNodeListener(createApp().use(router)))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture did not start')
  base = `http://127.0.0.1:${address.port}`
})
afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })

describe('brokered decision lifecycle', () => {
  it('notifies the external owner and returns the original owner-signed grant without a local agent row', async () => {
    const created = await send('create')
    expect(created.status).toBe(201)
    const grant = await created.json()
    expect(grant).toMatchObject({ status: 'pending', request: { requester: agent }, brokered: { owner, agent_issuer: broker } })
    expect(notified).toHaveBeenCalledWith(expect.objectContaining({ id: grant.id, brokered: expect.objectContaining({ owner }) }))
    expect((await send('token', grant.id)).status).toBe(400)
    const approved = await fetch(`${base}/grants/${grant.id}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${owner}` } })
    expect(approved.status).toBe(200)
    const response = await send('token', grant.id)
    expect(response.status).toBe(200)
    const { authz_jwt: jwt } = await response.json()
    const verified = await verifyAuthzJWT(jwt, { publicKey: keys.publicKey, expectedIss: issuer, expectedAud: 'shapes' })
    expect(verified.claims).toMatchObject({ sub: agent, decided_by: owner, brokered: grant.brokered })
    expect((await verifyAuthzJWT(jwt, { publicKey: brokerKeys.publicKey })).valid).toBe(false)
  })
  it('rejects other owners, agents, delegated callers, cross-origin browser writes and direct token retrieval', async () => {
    const grant = await (await send('create')).json()
    for (const subject of ['other@owner.test', agent, 'delegated', 'delegated-owner', '_management_']) {
      expect((await fetch(`${base}/grants/${grant.id}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${subject}` } })).status).toBe(403)
      expect((await fetch(`${base}/grants/${grant.id}`, { headers: { Authorization: `Bearer ${subject}` } })).status).toBe(403)
    }
    expect((await fetch(`${base}/grants/${grant.id}/approve`, { method: 'POST', headers: { 'x-session': owner, Origin: 'https://foreign.test' } })).status).toBe(403)
    expect((await fetch(`${base}/grants/${grant.id}/token`, { method: 'POST', headers: { Authorization: `Bearer ${owner}` } })).status).toBe(403)
    expect((await (await fetch(`${base}/grants`, { headers: { Authorization: `Bearer ${owner}` } })).json()).data).toHaveLength(1)
    expect((await (await fetch(`${base}/grants`, { headers: { Authorization: 'Bearer delegated-owner' } })).json()).data).toEqual([])
    expect((await grantStore.findById(grant.id))?.status).toBe('pending')
  })
  it('rejects replay, altered requests, cross-owner routing and revoked connections', async () => {
    const jti = randomUUID()
    expect((await send('create', undefined, { jti })).status).toBe(201)
    expect((await send('create', undefined, { jti })).status).toBe(409)
    expect((await send('create', undefined, { owner: 'other@owner.test' })).status).toBe(403)
    expect((await send('create', undefined, { operation: 'approve' })).status).toBe(400)
    expect((await send('create', undefined, { request: { requester: 'different@pods.provider.test' } })).status).toBe(400)
    connection.status = 'revoked'
    expect((await send('create')).status).toBe(403)
  })
})
