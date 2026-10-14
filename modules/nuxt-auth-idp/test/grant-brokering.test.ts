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
// The owner's own agent that holds a grants:read + grants:request delegation (issue 1473).
const upgrader = 'upgrader@owner.test'
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
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({}), useEvent: () => undefined, useStorage: () => ({}) }))
vi.mock('../src/runtime/server/utils/agent-auth', () => ({ tryBearerAuth: async (event: H3Event) => actor(event) }))
vi.mock('../src/runtime/server/utils/admin', () => ({ requireAuth: async (event: H3Event) => actor(event)?.sub ?? 'anonymous' }))
vi.mock('../src/runtime/server/utils/session', () => ({ getAppSession: async (event: H3Event) => ({ data: { userId: getHeader(event, 'x-session') } }) }))
// Card enrichment (registry adapters, registrations) is covered in grant-card.test.ts.
vi.mock('../src/runtime/server/utils/grant-card', () => ({ withGrantCards: async (grants: unknown[]) => grants }))
vi.mock('../src/runtime/server/utils/grant-stores', () => ({ useGrantStores: () => ({ grantStore }) }))
vi.mock('../src/runtime/server/utils/grant-pending-hooks', () => ({ runGrantPendingHooks: async (grant: unknown) => notified(grant) }))
vi.mock('../src/runtime/server/utils/stores', () => ({
  getIdpIssuer: () => issuer,
  useIdpStores: () => ({ keyStore: { getSigningKey: async () => ({ ...keys, kid: 'owner-key' }) }, userStore: { findByOwner: async () => [], findByApprover: async () => [], findByEmail: async (email: string) => email === owner || email === 'other@owner.test' ? { email, type: 'human', isActive: true } : email === upgrader ? { email, type: 'agent', owner, isActive: true } : null } }),
}))
vi.mock('../src/runtime/server/utils/grant-request-auth', () => ({ allowUnauthenticatedGrantRequests: () => false }))
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
const create = (await import('../src/runtime/server/api/grants/index.post')).default

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
  const router = createRouter().get('/grants', list).post('/grants', create).post('/brokered', mediated).post('/grants/:id/approve', approve).post('/grants/:id/token', directToken).get('/grants/:id', detail)
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
  it('stores a structured summary and rejects the removed text field', async () => {
    const request = { requester: agent, command: ['printf', 'fixture'], target_host: 'fixture', audience: 'shapes', grant_type: 'once' }
    const summary = { title: 'Print the fixture', description: 'Line one\nLine two', origin: 'Fixture Pod' }
    const created = await send('create', undefined, { request: { ...request, summary } })
    expect(created.status).toBe(201)
    expect((await created.json()).request.summary).toEqual(summary)
    expect((await send('create', undefined, { request: { ...request, summary: { text: 'Print the fixture' } } })).status).toBe(400)
  })
})

describe('grant upgrades through a grants delegation (issue 1473)', () => {
  const detail = (selector?: Record<string, string>) => {
    const chain = [{ resource: 'repo', ...(selector ? { selector } : {}) }]
    return { type: 'openape_cli', cli_id: 'git', operation_id: 'git.status', resource_chain: chain, action: 'read', permission: `git.repo[${selector ? `path=${selector.path}` : '*'}]#read`, display: 'Show working tree status', risk: 'low' }
  }
  const context = (argv: string[]) => ({ argv, adapter_id: 'git', adapter_version: '2', adapter_digest: 'SHA-256:adapter', resolved_executable: 'git' })
  const brokeredRead = (path: string, grantType = 'always') => ({ request: { requester: agent, target_host: 'fixture', audience: 'shapes', grant_type: grantType, authorization_details: [detail({ path })], execution_context: context(['git', '-C', path, 'status']) } })
  const proposal = { requester: agent, target_host: 'fixture', audience: 'shapes', grant_type: 'always', authorization_details: [detail()], execution_context: context(['git']), reason: 'Read any repository', summary: { title: 'Standing read access', description: 'It would have covered:\n- git -C /a status' } }

  async function delegatedToken(scopes = ['grants:read', 'grants:request']): Promise<string> {
    const { createDelegation } = await import('@openape/grants')
    const { SignJWT } = await import('jose')
    const delegation = await createDelegation({ delegator: owner, delegate: upgrader, audience: issuer, scopes, grant_type: 'always' }, grantStore)
    return new SignJWT({ act: { sub: upgrader }, delegation_grant: delegation.id }).setProtectedHeader({ alg: 'EdDSA' }).setIssuer(issuer).setSubject(owner).setAudience(issuer).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey)
  }
  const file = async (token: string, body: unknown) => fetch(`${base}/grants`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  it('lets a grants:read delegate list the owner\'s brokered grants', async () => {
    const grant = await (await send('create', undefined, brokeredRead('/a'))).json()
    const listed = await (await fetch(`${base}/grants`, { headers: { Authorization: `Bearer ${await delegatedToken(['grants:read'])}` } })).json()
    expect(listed.data.map((item: { id: string }) => item.id)).toContain(grant.id)
  })

  it('files a pending request for the owner\'s brokered identity with its broker binding, which the identity then reuses', async () => {
    const first = await (await send('create', undefined, brokeredRead('/a'))).json()
    const response = await file(await delegatedToken(), proposal)
    expect(response.status).toBe(201)
    const filed = await response.json()
    expect(filed).toMatchObject({ status: 'pending', brokered: first.brokered, request: { requester: agent, submitted_by: { delegate: upgrader }, summary: { title: 'Standing read access' } } })
    expect((await send('create', undefined, brokeredRead('/b'))).status).toBe(201)

    expect((await fetch(`${base}/grants/${filed.id}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${owner}` } })).status).toBe(200)
    const reused = await send('create', undefined, brokeredRead('/c'))
    expect(reused.status).toBe(200)
    expect((await reused.json()).id).toBe(filed.id)
    // A single-use request always asks the owner.
    expect((await send('create', undefined, brokeredRead('/c', 'once'))).status).toBe(201)
  })

  it('refuses a request for a brokered identity the owner has no active connection for', async () => {
    const token = await delegatedToken()
    expect((await file(token, proposal)).status).toBe(403)
    await send('create', undefined, brokeredRead('/a'))
    connection.status = 'revoked'
    expect((await file(token, proposal)).status).toBe(403)
  })

  it('refuses a brokered identity of another owner', async () => {
    await send('create', undefined, brokeredRead('/a'))
    const stored = (await grantStore.listGrants({})).data[0]!
    await grantStore.save({ ...stored, brokered: { ...stored.brokered!, owner: 'other@owner.test' } })
    expect((await file(await delegatedToken(), proposal)).status).toBe(403)
  })
})
