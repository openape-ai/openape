// @vitest-environment node
// POST /api/grants/authorize (issue 1473): the IdP resolves every program call
// with its own shapes and answers with a command token, one pending request or
// the owner's refusal. A brokered identity's call reaches its decision IdP as
// the signed `authorize` broker operation with the same body and answer.
import type { BrokerConnection, OpenApeGrant } from '@openape/core'
import type { H3Event } from 'h3'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { generateKeyPair } from '@openape/core'
import type { ServerShape } from '@openape/grants'
import { approveGrant, computeArgvHash, createInMemoryShapeStore, denyGrant, InMemoryGrantStore, revokeGrant, verifyAuthzJWT } from '@openape/grants'
import { createApp, createError, createRouter, getHeader, toNodeListener } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const issuer = 'https://id.owner.test'
const broker = 'https://pods.provider.test'
const owner = 'human@owner.test'
const direct = 'direct@owner.test'
const other = 'other-agent@owner.test'
const yolo = 'yolo@owner.test'
const podAgent = 'pod@pods.provider.test'
const tested = 'a'.repeat(64)
const untested = 'b'.repeat(64)

const role = new AsyncLocalStorage<'broker' | 'decision'>()
let keys: Awaited<ReturnType<typeof generateKeyPair>>
let brokerKeys: Awaited<ReturnType<typeof generateKeyPair>>
let grantStore: InMemoryGrantStore
let connection: BrokerConnection
let server: ReturnType<typeof createServer>
let base: string
const notified = vi.fn()
const tokensRecorded = vi.fn()

const gitShape: ServerShape = {
  cli_id: 'git',
  executable: 'git',
  description: 'Git',
  operations: [
    { id: 'git.status', command: ['status'], positionals: [], display: 'Show git status', action: 'read', risk: 'low', resource_chain: [] },
    { id: 'git.push', command: ['push'], positionals: ['remote', 'branch'], display: 'Push {branch} to {remote}', action: 'write', risk: 'high', resource_chain: ['remote:name={remote}'], exact_command: true },
  ],
  source: 'builtin',
  digest: 'SHA-256:semantic-v1',
  tested_digests: [`SHA-256:${tested}`],
  createdAt: 0,
  updatedAt: 0,
}
let shapeStore = createInMemoryShapeStore([gitShape])

vi.mock('../src/runtime/server/utils/agent-auth', () => ({
  tryBearerAuth: async (event: H3Event) => {
    const subject = getHeader(event, 'authorization')?.replace('Bearer ', '')
    return subject ? { sub: subject, act: subject === owner ? 'human' : 'agent' } : null
  },
}))
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({}), useEvent: () => undefined, useStorage: () => ({}) }))
vi.mock('../src/runtime/server/utils/grant-request-auth', () => ({ allowUnauthenticatedGrantRequests: () => false }))
vi.mock('../src/runtime/server/utils/grant-stores', () => ({ useGrantStores: () => ({ grantStore }) }))
vi.mock('../src/runtime/server/utils/shape-store', () => ({ useShapeStore: () => shapeStore }))
vi.mock('../src/runtime/server/utils/grant-pending-hooks', () => ({ runGrantPendingHooks: async (grant: unknown) => notified(grant) }))
vi.mock('../src/runtime/server/utils/stores', () => ({
  getIdpIssuer: () => role.getStore() === 'broker' ? broker : issuer,
  useIdpStores: () => ({
    keyStore: { getSigningKey: async () => role.getStore() === 'broker' ? { ...brokerKeys, kid: 'broker-key' } : { ...keys, kid: 'owner-key' } },
    userStore: { findByEmail: async (email: string) => email === podAgent ? { email, type: 'agent', isActive: true } : null },
    sshKeyStore: { findByUser: async (email: string) => email === podAgent ? [{ keyId: 'pod-key' }] : [] },
  }),
}))
vi.mock('../src/runtime/server/utils/broker-store', () => ({
  hasBrokerStore: () => true,
  useBrokerStore: () => ({
    getAgent: async (subject: string) => role.getStore() === 'broker' && subject === podAgent ? { subject, key_id: 'pod-key', owner, decision_issuer: issuer, connection_id: connection.id } : null,
    getConnection: async (id: string) => connection.id === id ? connection : null,
    acceptRequest: async () => connection,
    assertConnection: async () => { if (connection.status !== 'active') throw createError({ statusCode: 403 }) },
    recordToken: async (grant: OpenApeGrant) => tokensRecorded(grant.id),
  }),
}))
// The HTTPS transport is covered in broker-network.test.ts; here it is a plain loopback fetch with the same refusal relay.
vi.mock('../src/runtime/server/utils/broker-network', () => ({
  discoverBroker: async (decisionIssuer: string) => ({ issuer: decisionIssuer === issuer ? issuer : broker }),
  brokerEndpoint: () => `${base}/brokered`,
  brokerVerificationKey: async () => brokerKeys.publicKey,
  brokerFetch: async (url: string, init: { method: string, headers: Record<string, string>, body: string, relayRefusal?: boolean }) => {
    const response = await fetch(url, init)
    const body = await response.json() as Record<string, unknown>
    if (response.ok || (response.status === 403 && init.relayRefusal && ['denied', 'revoked'].includes(String(body.state)))) return body
    throw createError({ statusCode: response.status })
  },
}))

const { definePreApprovalHook } = await import('../src/runtime/server/utils/pre-approval-hooks')
definePreApprovalHook(async (_event, request) => request.requester === yolo ? { kind: 'yolo', decidedBy: owner } : null)
const { resetAuthorizeRateLimit } = await import('../src/runtime/server/utils/authorize-rate-limit')
const authorize = (await import('../src/runtime/server/api/grants/authorize.post')).default
const brokered = (await import('../src/runtime/server/api/brokered-grants.post')).default
const create = (await import('../src/runtime/server/api/grants/index.post')).default

interface CallInput { argv?: string[], sha256?: string, name?: string, grant_type?: string, [key: string]: unknown }
function body({ argv = ['status'], sha256 = tested, name = 'git', ...rest }: CallInput = {}) {
  return { target_host: 'macmini', audience: 'shapes', program: { name, sha256 }, argv, summary: { title: 'Check the repository', origin: 'Fixture Pod' }, ...rest }
}
async function call(subject: string | null, input: unknown = body(), path = '/grants/authorize') {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(subject ? { Authorization: `Bearer ${subject}` } : {}) }, body: typeof input === 'string' ? input : JSON.stringify(input) })
  return { status: response.status, headers: response.headers, json: await response.json() as Record<string, any> }
}
const viaBroker = (input: unknown = body()) => call(podAgent, input, '/pods/grants/authorize')
async function verified(token: string) {
  const result = await verifyAuthzJWT(token, { publicKey: keys.publicKey, expectedIss: issuer, expectedAud: 'shapes' })
  expect(result.valid).toBe(true)
  return result.claims!
}

beforeEach(async () => {
  keys = await generateKeyPair(); brokerKeys = await generateKeyPair()
  grantStore = new InMemoryGrantStore(); shapeStore = createInMemoryShapeStore([gitShape])
  notified.mockClear(); tokensRecorded.mockClear(); resetAuthorizeRateLimit()
  delete process.env.OPENAPE_RATE_LIMIT_MAX_AUTHORIZE
  connection = { id: randomUUID(), owner: { issuer, subject: owner }, broker_issuer: broker, agent_domain: 'pods.provider.test', status: 'active', created_at: 1 }
  const router = createRouter().post('/grants/authorize', authorize).post('/grants', create).post('/brokered', brokered).post('/pods/grants/authorize', authorize)
  const listener = toNodeListener(createApp().use(router))
  server = createServer((req, res) => role.run(req.url?.startsWith('/pods/') ? 'broker' : 'decision', () => listener(req, res)))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture did not start')
  base = `http://127.0.0.1:${address.port}`
})
afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })

describe('direct identities', () => {
  it('asks once, then answers a covered call with a token bound to its argv and program', async () => {
    const first = await call(direct)
    expect(first.status).toBe(202)
    expect(first.json).toEqual({ state: 'pending', grant_id: expect.any(String), approval_url: `${issuer}/grant-approval?grant_id=${first.json.grant_id}` })
    const stored = (await grantStore.findById(first.json.grant_id))!
    expect(stored.request).toMatchObject({ requester: direct, grant_type: 'always', command: ['git', 'status'], summary: { title: 'Check the repository' }, authorization_details: [{ cli_id: 'git', operation_id: 'git.status' }] })
    expect(stored.request.execution_context).toMatchObject({ argv: ['git', 'status'], argv_hash: await computeArgvHash(['git', 'status']), program_sha256: tested, version_tested: true, adapter_id: 'git' })

    // Pending reuse: the same call does not ask again.
    expect((await call(direct)).json).toMatchObject({ state: 'pending', grant_id: first.json.grant_id })
    await vi.waitFor(() => expect(notified).toHaveBeenCalledTimes(1))

    await approveGrant(first.json.grant_id, owner, grantStore)
    const approved = await call(direct)
    expect(approved.status).toBe(200)
    expect(approved.headers.get('cache-control')).toBe('no-store')
    expect(approved.json).toMatchObject({ state: 'approved', grant_id: first.json.grant_id, authz_jwt: expect.any(String), expires_at: expect.any(Number) })
    const claims = await verified(approved.json.authz_jwt)
    expect(claims).toMatchObject({ sub: direct, grant_id: first.json.grant_id, target_host: 'macmini', argv_hash: await computeArgvHash(['git', 'status']), program_sha256: tested })
    expect(claims.exp).toBe(approved.json.expires_at)
    expect(claims.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(300)

    // A structured approval covers another program file of the same name (approvals carry over versions).
    const otherVersion = await call(direct, body({ sha256: untested }))
    expect(otherVersion.status).toBe(200)
    expect((await verified(otherVersion.json.authz_jwt)).program_sha256).toBe(untested)
  })

  it('binds an exact command to its argv: another argv is not covered', async () => {
    const push = await call(direct, body({ argv: ['push', 'origin', 'main'] }))
    await approveGrant(push.json.grant_id, owner, grantStore)
    expect((await call(direct, body({ argv: ['push', 'origin', 'main'] }))).status).toBe(200)
    const otherBranch = await call(direct, body({ argv: ['push', 'origin', 'feature'] }))
    expect(otherBranch.status).toBe(202)
    expect(otherBranch.json.grant_id).not.toBe(push.json.grant_id)
  })

  it('falls back to an exact command without a shape, bound to argv and program file', async () => {
    const acme = 'd'.repeat(64)
    const first = await call(direct, body({ name: 'acme', argv: ['deploy'], sha256: acme }))
    expect(first.status).toBe(202)
    const detail = (await grantStore.findById(first.json.grant_id))!.request.authorization_details![0]!
    expect(detail).toMatchObject({ cli_id: 'acme', operation_id: '_generic.exec', constraints: { exact_command: true } })
    await approveGrant(first.json.grant_id, owner, grantStore)
    expect((await call(direct, body({ name: 'acme', argv: ['deploy'], sha256: acme }))).status).toBe(200)
    expect((await call(direct, body({ name: 'acme', argv: ['deploy', '--force'], sha256: acme }))).status).toBe(202)
    // Another file under the same name is a different, unknown program.
    expect((await call(direct, body({ name: 'acme', argv: ['deploy'], sha256: 'e'.repeat(64) }))).status).toBe(202)
  })

  it('matches an untested program hash by name and records version_tested false', async () => {
    const first = await call(direct, body({ sha256: untested }))
    const stored = (await grantStore.findById(first.json.grant_id))!
    expect(stored.request.authorization_details![0]).toMatchObject({ operation_id: 'git.status' })
    expect(stored.request.execution_context).toMatchObject({ program_sha256: untested, version_tested: false })
  })

  it('refuses client-resolved details and malformed calls before deciding anything', async () => {
    const detail = { type: 'openape_cli', cli_id: 'git', operation_id: 'git.status', resource_chain: [], action: 'read', permission: 'git.#read', display: 'x', risk: 'low' }
    for (const input of [{ ...body(), authorization_details: [detail] }, { ...body(), execution_context: { argv: ['git'] } }, { ...body(), program: { name: 'git' } }, body({ argv: Array.from({ length: 257 }, () => 'x') }), body({ grant_type: 'timed' }), 'not json']) {
      expect((await call(direct, input)).status).toBe(400)
    }
    expect((await call(direct, { ...body(), padding: 'x'.repeat(130 * 1024) })).status).toBe(413)
    expect((await call(null)).status).toBe(401)
    expect(await grantStore.findByRequester(direct)).toEqual([])
  })

  it('refuses after a denial or revocation without asking again', async () => {
    const denied = await call(direct)
    await denyGrant(denied.json.grant_id, owner, grantStore)
    const refused = await call(direct)
    expect(refused.status).toBe(403)
    expect(refused.headers.get('content-type')).toContain('application/problem+json')
    expect(refused.json).toMatchObject({ state: 'denied', grant_id: denied.json.grant_id, status: 403 })

    const push = await call(direct, body({ argv: ['push', 'origin', 'main'] }))
    await approveGrant(push.json.grant_id, owner, grantStore)
    await revokeGrant(push.json.grant_id, grantStore)
    expect((await call(direct, body({ argv: ['push', 'origin', 'main'] }))).json).toMatchObject({ state: 'revoked', grant_id: push.json.grant_id })
    expect(await grantStore.findByRequester(direct)).toHaveLength(2)
  })

  it('never lets one subject use another subject\'s grant', async () => {
    const first = await call(direct)
    await approveGrant(first.json.grant_id, owner, grantStore)
    const foreign = await call(other)
    expect(foreign.status).toBe(202)
    expect(foreign.json.grant_id).not.toBe(first.json.grant_id)
  })

  it('consumes nothing itself: a single-use approval covers until it is used', async () => {
    const once = await call(direct, body({ grant_type: 'once' }))
    await approveGrant(once.json.grant_id, owner, grantStore)
    expect((await call(direct, body({ grant_type: 'once' }))).json).toMatchObject({ state: 'approved', grant_id: once.json.grant_id })
    await grantStore.updateStatus(once.json.grant_id, 'used', { used_at: Math.floor(Date.now() / 1000) })
    const next = await call(direct, body({ grant_type: 'once' }))
    expect(next.status).toBe(202)
    expect(next.json.grant_id).not.toBe(once.json.grant_id)
  })

  it('lets a standing grant and a pre-approval hook decide for direct identities', async () => {
    const standing = { id: randomUUID(), type: 'standing' as const, status: 'approved' as const, decided_by: owner, created_at: 1, request: { type: 'standing', owner, delegate: direct, requester: direct, audience: 'shapes', target_host: '*', cli_id: 'git', action: 'read', resource_chain_template: [], grant_type: 'always' } }
    await grantStore.save(standing as unknown as OpenApeGrant)
    const covered = await call(direct)
    expect(covered.status).toBe(200)
    expect(await grantStore.findById(covered.json.grant_id)).toMatchObject({ status: 'approved', decided_by_standing_grant: standing.id, auto_approval_kind: 'standing' })

    const hooked = await call(yolo)
    expect(hooked.status).toBe(200)
    expect(await grantStore.findById(hooked.json.grant_id)).toMatchObject({ status: 'approved', auto_approval_kind: 'yolo', decided_by: owner })
  })

  it('limits calls per requester subject', async () => {
    process.env.OPENAPE_RATE_LIMIT_MAX_AUTHORIZE = '3'
    for (let index = 0; index < 3; index++) expect((await call(direct)).status).toBe(202)
    const limited = await call(direct)
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await call(other)).status).toBe(202)
  })

  it('keeps POST /api/grants for older clients and refuses IdP-only context fields there', async () => {
    const legacy = { requester: direct, target_host: 'macmini', audience: 'shapes', grant_type: 'once', command: ['printf', 'x'] }
    const send = async (request: unknown) => fetch(`${base}/grants`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${direct}` }, body: JSON.stringify(request) })
    expect((await send(legacy)).status).toBe(201)
    expect((await send({ ...legacy, execution_context: { argv: ['printf', 'x'], adapter_id: 'p', adapter_version: '1', adapter_digest: 'd', resolved_executable: 'printf', program_sha256: tested } })).status).toBe(400)
  })
})

describe('brokered identities', () => {
  it('forwards the call as the signed authorize operation and relays every answer unchanged', async () => {
    const first = await viaBroker()
    expect(first.status).toBe(202)
    expect(first.json).toEqual({ state: 'pending', grant_id: expect.any(String), approval_url: `${issuer}/grant-approval?grant_id=${first.json.grant_id}` })
    const stored = (await grantStore.findById(first.json.grant_id))!
    expect(stored).toMatchObject({ brokered: { owner, connection_id: connection.id, broker_issuer: broker, key_id: 'pod-key' }, request: { requester: podAgent, execution_context: { program_sha256: tested } } })
    expect(notified).toHaveBeenCalledTimes(1)
    expect((await viaBroker()).json.grant_id).toBe(first.json.grant_id)

    await approveGrant(first.json.grant_id, owner, grantStore)
    const approved = await viaBroker()
    expect(approved.status).toBe(200)
    const claims = await verified(approved.json.authz_jwt)
    expect(claims).toMatchObject({ sub: podAgent, brokered: stored.brokered, program_sha256: tested, argv_hash: await computeArgvHash(['git', 'status']) })
    expect(tokensRecorded).toHaveBeenCalledWith(first.json.grant_id)

    const push = await viaBroker(body({ argv: ['push', 'origin', 'main'] }))
    await denyGrant(push.json.grant_id, owner, grantStore)
    const refused = await viaBroker(body({ argv: ['push', 'origin', 'main'] }))
    expect(refused.status).toBe(403)
    expect(refused.json).toMatchObject({ state: 'denied', grant_id: push.json.grant_id })
  })

  it('uses only grants of the same broker binding and never standing grants', async () => {
    const own = await call(podAgent)
    // Without a binding at the decision IdP this is a direct grant of the same subject name.
    await approveGrant(own.json.grant_id, owner, grantStore)
    const standing = { id: randomUUID(), type: 'standing', status: 'approved', decided_by: owner, created_at: 1, request: { type: 'standing', owner, delegate: podAgent, requester: podAgent, audience: 'shapes', target_host: '*', resource_chain_template: [], grant_type: 'always' } }
    await grantStore.save(standing as unknown as OpenApeGrant)
    const brokeredCall = await viaBroker()
    expect(brokeredCall.status).toBe(202)
    expect(brokeredCall.json.grant_id).not.toBe(own.json.grant_id)
  })

  it('refuses the call when the broker connection was revoked', async () => {
    connection.status = 'revoked'
    expect((await viaBroker()).status).toBe(403)
    expect(await grantStore.findByRequester(podAgent)).toEqual([])
  })

  it('rejects a malformed brokered call at the broker before forwarding', async () => {
    expect((await viaBroker({ ...body(), authorization_details: [] })).status).toBe(400)
    expect(await grantStore.findByRequester(podAgent)).toEqual([])
  })
})
