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
import { approveGrant, approveGrantWithWidening, approveGrantWithExtension, computeArgvHash, createInMemoryShapeStore, denyGrant, InMemoryGrantStore, revokeGrant, verifyAuthzJWT } from '@openape/grants'
import { createApp, createError, createRouter, getHeader, toNodeListener } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import activityGrants from './fixtures/issue-1476-activity-grants.json'

const issuer = 'https://id.owner.test'
const broker = 'https://pods.provider.test'
const owner = 'human@owner.test'
const direct = 'direct@owner.test'
const other = 'other-agent@owner.test'
const yolo = 'yolo@owner.test'
const podAgent = 'pod@pods.provider.test'
const inactive = 'inactive@owner.test'
const activeAccounts = new Set([direct, other, yolo, podAgent])
let brokerBusy = false
let withdrawSupported = true
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
const toolShape: ServerShape = {
  ...gitShape,
  cli_id: 'tool',
  executable: 'tool',
  operations: [
    { id: 'tool.view', command: ['view'], positionals: ['repo'], display: 'View {repo}', action: 'read', risk: 'low', resource_chain: ['repo:name={repo}'] },
    { id: 'tool.show', command: ['show'], positionals: ['repo'], display: 'Show {repo}', action: 'read', risk: 'low', resource_chain: ['repo:name={repo}'] },
  ],
  tested_digests: undefined,
}
// The Pods desktop performs pod-runtime itself; the seed marks such shapes virtual.
const podRuntimeShape: ServerShape = {
  ...gitShape,
  cli_id: 'pod-runtime',
  executable: 'pod-runtime',
  operations: [{ id: 'run', command: ['run'], positionals: [], value_options: ['pod'], display: 'Run Pod {pod}', action: 'run', risk: 'high', resource_chain: ['pod:id={pod}'] }],
  tested_digests: undefined,
  virtual: true,
}
let shapeStore = createInMemoryShapeStore([gitShape, toolShape, podRuntimeShape])

vi.mock('../src/runtime/server/utils/agent-auth', () => ({
  tryBearerAuth: async (event: H3Event) => {
    const subject = getHeader(event, 'authorization')?.replace('Bearer ', '')
    return subject ? { sub: subject, act: subject === owner ? 'human' : 'agent' } : null
  },
}))
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({}), useEvent: () => undefined, useStorage: () => ({}) }))
vi.mock('../src/runtime/server/utils/grant-card', () => ({ withGrantCards: async (grants: unknown[]) => grants }))
vi.mock('../src/runtime/server/utils/grant-request-auth', () => ({ allowUnauthenticatedGrantRequests: () => false }))
vi.mock('../src/runtime/server/utils/grant-stores', () => ({ useGrantStores: () => ({ grantStore }) }))
vi.mock('../src/runtime/server/utils/shape-store', () => ({ useShapeStore: () => shapeStore }))
vi.mock('../src/runtime/server/utils/grant-pending-hooks', () => ({ runGrantPendingHooks: async (grant: unknown) => notified(grant) }))
vi.mock('../src/runtime/server/utils/stores', () => ({
  getIdpIssuer: () => role.getStore() === 'broker' ? broker : issuer,
  useIdpStores: () => ({
    keyStore: { getSigningKey: async () => role.getStore() === 'broker' ? { ...brokerKeys, kid: 'broker-key' } : { ...keys, kid: 'owner-key' } },
    userStore: { findByOwner: async () => [], findByApprover: async () => [], findByEmail: async (email: string) => activeAccounts.has(email) || email === inactive ? { email, type: 'agent', isActive: email !== inactive } : null },
    sshKeyStore: { findByUser: async (email: string) => email === podAgent ? [{ keyId: 'pod-key' }] : [] },
  }),
}))
vi.mock('../src/runtime/server/utils/broker-store', () => ({
  hasBrokerStore: () => true,
  useBrokerStore: () => ({
    getAgent: async (subject: string) => role.getStore() === 'broker' && subject === podAgent ? { subject, key_id: 'pod-key', owner, decision_issuer: issuer, connection_id: connection.id } : null,
    getConnection: async (id: string) => connection.id === id ? connection : null,
    acceptRequest: async () => {
      if (brokerBusy) throw createError({ statusCode: 429, data: { retry_after: 17 } })
      return connection
    },
    assertConnection: async () => { if (connection.status !== 'active') throw createError({ statusCode: 403 }) },
    recordToken: async (grant: OpenApeGrant) => tokensRecorded(grant.id),
  }),
}))
// The HTTPS transport is covered in broker-network.test.ts; here it is a plain loopback fetch with the same refusal relay.
vi.mock('../src/runtime/server/utils/broker-network', () => ({
  discoverBroker: async (decisionIssuer: string) => ({ issuer: decisionIssuer === issuer ? issuer : broker, openape_grant_reference_supported: true, openape_grant_withdraw_supported: withdrawSupported }),
  brokerEndpoint: () => `${base}/brokered`,
  brokerVerificationKey: async () => brokerKeys.publicKey,
  brokerFetch: async (url: string, init: { method: string, headers: Record<string, string>, body: string, relayRefusal?: boolean }) => {
    const response = await fetch(url, init)
    const body = await response.json() as Record<string, unknown>
    if (response.ok || (response.status === 403 && init.relayRefusal && ['denied', 'revoked', 'expired', 'used', 'withdrawn'].includes(String(body.state)))) return body
    throw createError({ statusCode: response.status, data: { retry_after: Number(response.headers.get('retry-after')) || undefined } })
  },
}))

const { definePreApprovalHook } = await import('../src/runtime/server/utils/pre-approval-hooks')
definePreApprovalHook(async (_event, request) => request.requester === yolo ? { kind: 'yolo', decidedBy: owner } : null)
const { resetAuthorizeRateLimit } = await import('../src/runtime/server/utils/authorize-rate-limit')
const { _internals: ipLimiter } = await import('../src/runtime/server/plugins/rate-limit')
const consume = (await import('../src/runtime/server/api/grants/[id]/consume.post')).default
const authorize = (await import('../src/runtime/server/api/grants/authorize.post')).default
const brokered = (await import('../src/runtime/server/api/brokered-grants.post')).default
const create = (await import('../src/runtime/server/api/grants/index.post')).default
const list = (await import('../src/runtime/server/api/grants/index.get')).default
const withdraw = (await import('../src/runtime/server/api/grants/withdraw.post')).default

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
  grantStore = new InMemoryGrantStore(); shapeStore = createInMemoryShapeStore([gitShape, toolShape, podRuntimeShape])
  notified.mockClear(); tokensRecorded.mockClear(); resetAuthorizeRateLimit(); ipLimiter.reset()
  brokerBusy = false
  withdrawSupported = true
  delete process.env.OPENAPE_RATE_LIMIT_MAX_AUTHORIZE
  delete process.env.OPENAPE_RATE_LIMIT_MAX_AGENT
  connection = { id: randomUUID(), owner: { issuer, subject: owner }, broker_issuer: broker, agent_domain: 'pods.provider.test', status: 'active', created_at: 1 }
  const router = createRouter().get('/grants', list).get('/pods/grants', list).post('/grants/authorize', authorize).post('/grants', create).post('/brokered', brokered).post('/pods/grants/authorize', authorize).post('/grants/:id/consume', consume).post('/grants/withdraw', withdraw).post('/pods/grants/withdraw', withdraw)
  const listener = toNodeListener(createApp().use(router))
  server = createServer((req, res) => role.run(req.url?.startsWith('/pods/') ? 'broker' : 'decision', () => listener(req, res)))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture did not start')
  base = `http://127.0.0.1:${address.port}`
})
afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })

describe('direct identities', () => {
  it('binds approval and command tokens to script content, not only its path', async () => {
    const files = [{ path: '/scripts/task.cjs', sha256: tested }]
    const request = body({ name: 'node', argv: ['/scripts/task.cjs'], files })
    const pending = await call(direct, request)
    expect(pending.status).toBe(202)
    await approveGrant(pending.json.grant_id, owner, grantStore)

    const approved = await call(direct, request)
    expect(approved.status).toBe(200)
    expect((await verified(approved.json.authz_jwt)).execution_context?.files).toEqual(files)
    const changed = await call(direct, { ...request, files: [{ path: '/scripts/task.cjs', sha256: untested }] })
    expect(changed.status).toBe(202)
    expect(changed.json.grant_id).not.toBe(pending.json.grant_id)
    const omitted = await call(direct, body({ name: 'node', argv: ['/scripts/task.cjs'] }))
    expect(omitted.status).toBe(202)
    expect(omitted.json.grant_id).not.toBe(pending.json.grant_id)
  })

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
    // Over 64 KiB, so a maximal body still fits the 128 KiB broker assertion; refused by Content-Length before reading.
    expect((await call(direct, { ...body(), padding: 'x'.repeat(65 * 1024) })).status).toBe(413)
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

  it('spends a single-use approval when it issues the token, and consume confirms it', async () => {
    const once = await call(direct, body({ grant_type: 'once' }))
    await approveGrant(once.json.grant_id, owner, grantStore)
    const issued = await call(direct, body({ grant_type: 'once' }))
    expect(issued.json).toMatchObject({ state: 'approved', grant_id: once.json.grant_id })
    expect(await grantStore.findById(once.json.grant_id)).toMatchObject({ status: 'used', used_at: expect.any(Number) })
    // A second call gets no token from the spent grant.
    const next = await call(direct, body({ grant_type: 'once' }))
    expect(next.status).toBe(202)
    expect(next.json.grant_id).not.toBe(once.json.grant_id)

    // apes consumes right before executing: the first redemption of the command token confirms,
    // every replay, with the same or any other token, is refused.
    const consumeWith = async (token: string) => (await fetch(`${base}/grants/${once.json.grant_id}/consume`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).json()
    expect(await consumeWith(issued.json.authz_jwt)).toMatchObject({ status: 'consumed', grant: { id: once.json.grant_id } })
    expect(await consumeWith(issued.json.authz_jwt)).toMatchObject({ error: 'already_consumed', status: 'used' })
    const { issueAuthzJWT } = await import('@openape/grants')
    const plain = await issueAuthzJWT({ ...(await grantStore.findById(once.json.grant_id))!, status: 'approved' }, issuer, keys.privateKey)
    expect(await consumeWith(plain)).toMatchObject({ error: 'already_consumed', status: 'used' })
  })

  it('confirms exactly one of concurrent redemptions of a command token', async () => {
    const once = await call(direct, body({ grant_type: 'once' }))
    await approveGrant(once.json.grant_id, owner, grantStore)
    const issued = await call(direct, body({ grant_type: 'once' }))
    const redeem = async () => (await fetch(`${base}/grants/${once.json.grant_id}/consume`, { method: 'POST', headers: { Authorization: `Bearer ${issued.json.authz_jwt}` } })).json()
    const answers = await Promise.all([redeem(), redeem(), redeem()])
    expect(answers.filter(answer => answer.status === 'consumed')).toHaveLength(1)
    expect(answers.filter(answer => answer.error === 'already_consumed')).toHaveLength(2)
  })

  it('issues one token from a single-use grant to concurrent calls', async () => {
    const once = await call(direct, body({ grant_type: 'once' }))
    await approveGrant(once.json.grant_id, owner, grantStore)
    const answers = await Promise.all([call(direct, body({ grant_type: 'once' })), call(direct, body({ grant_type: 'once' }))])
    expect(answers.filter(answer => answer.json.state === 'approved' && answer.json.grant_id === once.json.grant_id)).toHaveLength(1)
  })

  it('never turns a `*` in an argument into a glob: approving `org/*` does not cover `org/secret`', async () => {
    const glob = await call(direct, body({ name: 'tool', sha256: untested, argv: ['view', 'org/*'] }))
    expect((await grantStore.findById(glob.json.grant_id))!.request.authorization_details![0]).toMatchObject({ operation_id: '_generic.exec', constraints: { exact_command: true } })
    await approveGrant(glob.json.grant_id, owner, grantStore)
    expect((await call(direct, body({ name: 'tool', sha256: untested, argv: ['view', 'org/*'] }))).status).toBe(200)
    const secret = await call(direct, body({ name: 'tool', sha256: untested, argv: ['view', 'org/secret'] }))
    expect(secret.status).toBe(202)
  })

  it('matches denials by structured detail, not by an equal permission string', async () => {
    const view = await call(direct, body({ name: 'tool', sha256: untested, argv: ['view', 'org/repo'] }))
    const show = { ...(await grantStore.findById(view.json.grant_id))! }
    await denyGrant(view.json.grant_id, owner, grantStore)
    expect((await call(direct, body({ name: 'tool', sha256: untested, argv: ['view', 'org/repo'] }))).status).toBe(403)
    // tool.show prints the same permission as tool.view but is another operation.
    const other = await call(direct, body({ name: 'tool', sha256: untested, argv: ['show', 'org/repo'] }))
    expect((await grantStore.findById(other.json.grant_id))!.request.permissions).toEqual(show.request.permissions)
    expect(other.status).toBe(202)
  })

  it('refuses a program named like a desktop-own executable, even when a runtime grant exists', async () => {
    // The Pod's runtime grant, requested by the desktop through POST /api/grants.
    const runtime = { type: 'openape_cli' as const, cli_id: 'pod-runtime', operation_id: 'run', resource_chain: [{ resource: 'pod', selector: { id: 'p-1' } }], action: 'run', permission: 'pod-runtime.pod[id=p-1]#run', display: 'Run Pod p-1', risk: 'high' as const }
    await grantStore.save({ id: randomUUID(), status: 'approved', created_at: 1, decided_by: owner, request: { requester: direct, target_host: 'macmini', audience: 'shapes', grant_type: 'always', authorization_details: [runtime], permissions: [runtime.permission] } })
    const before = await grantStore.findByRequester(direct)
    const refused = await call(direct, body({ name: 'pod-runtime', sha256: untested, argv: ['run', '--pod', 'p-1'] }))
    expect(refused.status).toBe(400)
    expect(refused.json.statusMessage ?? refused.json.message).toContain('Pods desktop')
    expect(await grantStore.findByRequester(direct)).toEqual(before)
    // The same refusal reaches a brokered identity through its broker.
    expect((await viaBroker(body({ name: 'pod-runtime', sha256: untested, argv: ['run', '--pod', 'p-1'] }))).status).toBe(400)
    expect(await grantStore.findByRequester(podAgent)).toEqual([])
  })

  it('refuses inactive or unknown requester accounts before deciding', async () => {
    expect((await call(inactive)).status).toBe(403)
    expect((await call('unknown@owner.test')).status).toBe(403)
    expect(await grantStore.findByRequester(inactive)).toEqual([])
  })

  it('charges calls without a valid bearer token to the per-IP agent bucket', async () => {
    process.env.OPENAPE_RATE_LIMIT_MAX_AGENT = '2'
    expect((await call(null)).status).toBe(401)
    expect((await call(null)).status).toBe(401)
    const limited = await call(null)
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    // Verified requesters keep their own budget.
    expect((await call(direct)).status).toBe(202)
  })

  it('requires one exact human approval despite broad grants, standing rules and auto-approval hooks', async () => {
    const existing = await call(direct)
    await approveGrant(existing.json.grant_id, owner, grantStore)
    await shapeStore.saveShape({ ...gitShape, operations: gitShape.operations.map(operation => operation.id === 'git.status' ? { ...operation, exact_command: true, decision: 'once' } : { ...operation, decision: 'deny' }) })
    const standing = { id: randomUUID(), type: 'standing', status: 'approved', decided_by: owner, created_at: 1, request: { type: 'standing', owner, delegate: direct, requester: direct, audience: 'shapes', target_host: '*', cli_id: 'git', action: 'read', resource_chain_template: [], grant_type: 'always' } }
    await grantStore.save(standing as unknown as OpenApeGrant)
    const pending = await call(direct)
    expect(pending.status).toBe(202)
    expect(pending.json.grant_id).not.toBe(existing.json.grant_id)
    expect((await grantStore.findById(pending.json.grant_id))?.request.grant_type).toBe('once')
    await expect(approveGrant(pending.json.grant_id, owner, grantStore, { grant_type: 'always' })).rejects.toThrow('single-use')
    await expect(approveGrantWithWidening(pending.json.grant_id, owner, grantStore, [])).rejects.toThrow('cannot be widened')
    await expect(approveGrantWithExtension(pending.json.grant_id, owner, grantStore, { extend_mode: 'merge', extend_grant_ids: [existing.json.grant_id] })).rejects.toThrow('cannot be widened')
    expect((await call(yolo)).status).toBe(202)
    expect((await viaBroker()).status).toBe(202)
    await approveGrant(pending.json.grant_id, owner, grantStore)
    const approved = await call(direct)
    expect(approved.status).toBe(200)
    expect((await verified(approved.json.authz_jwt)).grant_type).toBe('once')
    const repeated = await call(direct)
    expect(repeated.status).toBe(202)
    expect(repeated.json.grant_id).not.toBe(pending.json.grant_id)
    expect((await call(direct, body({ argv: ['push', 'origin', 'main'] }))).status).toBe(400)
    expect((await call(direct, body({ argv: ['unknown'] }))).status).toBe(400)
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

  it('relays the decision IdP\'s Retry-After when its broker budget is spent', async () => {
    brokerBusy = true
    const limited = await viaBroker()
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('17')
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

// Issue 1476: the PR monitor's Azure DevOps activity query, with the two grants production holds for it
// (an old-desktop `pr.activity.read` grant and an IdP-resolved `rest.post` grant), identifiers replaced.
describe('a long command approved before and after IdP resolution (issue 1476)', () => {
  const azSha = '7eb79dbdb36ccb6f3f008afd5780b8da06e6cb46c5cc4441dad19b2926100f82'
  const azShape: ServerShape = {
    ...gitShape,
    cli_id: 'az',
    executable: 'az',
    operations: [
      { id: 'rest.get', command: ['rest', '--method', 'GET'], positionals: [], required_options: ['resource', 'url'], value_options: ['output'], flag_options: ['only-show-errors'], display: 'Azure REST GET {url} with audience {resource}', action: 'read', risk: 'medium', resource_chain: ['http:method=GET', 'audience:id={resource}', 'endpoint:url={url}'] },
      { id: 'rest.post', command: ['rest', '--method', 'POST'], positionals: [], required_options: ['resource', 'url', 'body'], value_options: ['output'], flag_options: ['only-show-errors'], display: 'Azure REST POST to {url} with audience {resource}', action: 'request', risk: 'medium', resource_chain: ['http:method=POST', 'audience:id={resource}', 'endpoint:url={url}'] },
    ],
    tested_digests: [`SHA-256:${azSha}`],
  }
  const [readGrant, requestGrant] = activityGrants as unknown as [OpenApeGrant, OpenApeGrant]
  const targetHost = requestGrant.request.target_host
  const activityArgv = requestGrant.request.command!.slice(1)
  const activity = (argv = activityArgv) => body({ name: 'az', sha256: azSha, argv, target_host: targetHost })
  async function store(...grants: OpenApeGrant[]) {
    for (const grant of grants) await grantStore.save({ ...structuredClone(grant), brokered: { connection_id: connection.id, broker_issuer: broker, agent_issuer: broker, owner, key_id: 'pod-key' } })
  }

  beforeEach(() => { shapeStore = createInMemoryShapeStore([gitShape, azShape]) })

  it('relays the command token of the IdP-resolved grant through the broker', async () => {
    await store(readGrant, requestGrant)
    const answer = await viaBroker(activity())
    expect(answer.status).toBe(200)
    const claims = await verified(answer.json.authz_jwt)
    expect(claims).toMatchObject({ grant_id: requestGrant.id, sub: podAgent, argv_hash: await computeArgvHash(requestGrant.request.command!), program_sha256: azSha, authorization_details: [{ operation_id: 'rest.post', action: 'request' }] })
  })

  it('never lets the old read grant authorize the POST: the call asks the owner instead', async () => {
    await store(readGrant)
    const answer = await viaBroker(activity())
    expect(answer.status).toBe(202)
    expect(answer.json.grant_id).not.toBe(readGrant.id)
    expect(tokensRecorded).not.toHaveBeenCalled()
  })

  it('refuses a command too large for any command token as definite, without spending a single-use grant', async () => {
    const huge = activityArgv.map((item, index) => activityArgv[index - 1] === '--body' ? JSON.stringify({ padding: 'x'.repeat(40_000) }) : item)
    const asked = await viaBroker(activity(huge))
    expect(asked.status).toBe(202)
    const single = (await grantStore.findById(asked.json.grant_id))!
    await grantStore.save({ ...single, request: { ...single.request, grant_type: 'once' } })
    await approveGrant(asked.json.grant_id, owner, grantStore)
    const refused = await viaBroker(activity(huge))
    expect(refused.status).toBe(413)
    expect(refused.json.authz_jwt).toBeUndefined()
    expect(tokensRecorded).not.toHaveBeenCalled()
    expect((await grantStore.findById(asked.json.grant_id))!.status).toBe('approved')
  })

  it('logs an unexpected failure at broker and decision IdP with a request id, naming only program and operation', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      vi.spyOn(grantStore, 'findByRequester').mockRejectedValue(new TypeError(`broken row ${activityArgv.join(' ')}`))
      const failed = await viaBroker(activity())
      expect(failed.status).toBeGreaterThanOrEqual(500)
      const lines = logged.mock.calls.map(args => args.join(' '))
      expect(lines).toHaveLength(2)
      expect(lines[0]).toMatch(/^\[grants\/authorize\] request [\da-f-]{36} failed with HTTP 500 .* cli="az" operation="rest.post" cause=TypeError at /)
      expect(lines[1]).toMatch(/^\[grants\/authorize\] request [\da-f-]{36} failed with HTTP 5\d\d .* cli="az"$/)
      for (const line of lines) expect(line).not.toContain('HierarchyQuery')
      expect(failed.json.data.request_id).toBe(lines[1]!.split(' ')[2])
    }
    finally { logged.mockRestore() }
  })
})

// Issue 1476: grants approved by older desktops carry details the IdP never wrote. A malformed one covers nothing.
describe('stored grants of older clients', () => {
  const malformed: unknown[] = [
    null,
    'git.status',
    { type: 'openape_cli', cli_id: 'git', operation_id: 'git.status', action: 'read', permission: 'git#read', display: 'x', risk: 'low' },
    { type: 'openape_cli', cli_id: 'git', operation_id: 'git.status', action: 'read', permission: 'git#read', display: 'x', risk: 'low', resource_chain: [null] },
    { type: 'openape_cli', cli_id: 'git', operation_id: 'git.status', action: 'read', permission: 'git#read', display: 'x', risk: 'low', resource_chain: [{ resource: 'repo', selector: { name: 7 } }] },
    { type: 'openape_cli', cli_id: 'git', operation_id: 'git.status', action: 'read', permission: 'git#read', display: 'x', risk: 'low', resource_chain: 'repo' },
  ]
  async function stored(details: unknown, extra: Record<string, unknown> = {}) {
    const grant = { id: randomUUID(), type: 'command', status: 'approved', decided_by: owner, created_at: 1, request: { requester: direct, target_host: 'macmini', audience: 'shapes', grant_type: 'always', authorization_details: details, ...extra } }
    await grantStore.save(grant as unknown as OpenApeGrant)
    return grant.id
  }

  it('decides calls next to malformed details instead of failing, and never lets them cover a call', async () => {
    for (const detail of malformed) await stored([detail])
    await stored({ not: 'a list' })
    await stored([{ ...gitShape, type: 'openape_cli', cli_id: 'git', operation_id: 'git.push', action: 'write', permission: 'git.remote[name=origin]#write', display: 'x', risk: 'high', resource_chain: [{ resource: 'remote', selector: { name: 'origin' } }], constraints: { exact_command: true } }], { execution_context: null })
    const asked = await call(direct)
    expect(asked.status).toBe(202)
    expect((await call(direct, body({ argv: ['push', 'origin', 'main'] }))).status).toBe(202)
  })

  it('still lets a well-formed old grant cover the call it describes', async () => {
    await stored([malformed[3]])
    const covering = await stored([{ type: 'openape_cli', cli_id: 'git', operation_id: 'git.status', action: 'read', permission: 'git.#read', display: 'Show git status', risk: 'low', resource_chain: [] }], { execution_context: { argv: ['git', 'status'] } })
    const answer = await call(direct)
    expect(answer.status).toBe(200)
    expect(answer.json.grant_id).toBe(covering)
  })
})

describe('opaque operation references', () => {
  it.each([false, true])('deduplicates concurrent submissions and refuses changed bindings (brokered: %s)', async (federated) => {
    const submit = federated ? viaBroker : (input: unknown) => call(direct, input)
    const request = body({ name: 'document-export', argv: ['render', 'report-42'], grant_type: 'once', reference: 'report-42:pdf:v1', batch: { id: 'reports' } })
    const replies = await Promise.all(Array.from({ length: 5 }, () => submit(request)))
    expect(replies.every(reply => reply.status === 202)).toBe(true)
    expect(new Set(replies.map(reply => reply.json.grant_id)).size).toBe(1)
    expect(notified).toHaveBeenCalledTimes(1)
    const id = replies[0]!.json.grant_id
    expect(new URL(replies[0]!.json.approval_url).searchParams.get('batch')).toBe('reports')
    expect((await submit({ ...request, argv: ['render', 'report-43'] })).status).toBe(409)
    expect((await submit({ ...request, program: { ...request.program, sha256: untested } })).status).toBe(409)
    const retry = await submit({ ...request, summary: { title: 'Different presentation' }, batch: { id: 'next-run' } })
    expect(retry.json.grant_id).toBe(id)
    expect((await grantStore.findById(id))?.request.batch?.id).toBe('reports')
    await approveGrant(id, owner, grantStore)
    const lookupPath = federated ? '/pods/grants' : '/grants'
    const requester = federated ? podAgent : direct
    const lookup = await fetch(`${base}${lookupPath}?${new URLSearchParams({ requester, reference: request.reference as string })}`, { headers: { Authorization: `Bearer ${requester}` } })
    expect(lookup.status).toBe(200)
    expect(await lookup.json()).toMatchObject({ data: [{ id, status: 'approved' }] })
    expect((await grantStore.findById(id))?.status).toBe('approved')
    const execution = await submit(request)
    expect(execution.status).toBe(200)
    expect((await verified(execution.json.authz_jwt)).grant_id).toBe(id)
    const repeated = await submit(request)
    expect(repeated).toMatchObject({ status: 403, json: { state: 'used', grant_id: id } })
    expect(await grantStore.findByRequester(federated ? podAgent : direct)).toHaveLength(1)
  })

  it.each(['denied', 'revoked', 'expired'] as const)('returns terminal %s without replacement', async (status) => {
    const request = body({ grant_type: 'once', reference: 'stable-operation' })
    const first = await call(direct, request)
    await grantStore.updateStatus(first.json.grant_id, status)
    expect(await call(direct, request)).toMatchObject({ status: 403, json: { state: status, grant_id: first.json.grant_id } })
    expect(await grantStore.findByRequester(direct)).toHaveLength(1)
  })

  it('creates or reads through the direct grant endpoint without spending an approved decision', async () => {
    const request = { requester: direct, target_host: 'fixture', audience: 'shapes', command: ['export', 'document-42'], grant_type: 'once', reference: 'document-42:v1' }
    const first = await call(direct, request, '/grants')
    expect(first.status).toBe(201)
    await approveGrant(first.json.id, owner, grantStore)
    const retry = await call(direct, request, '/grants')
    expect(retry).toMatchObject({ status: 200, json: { id: first.json.id, status: 'approved' } })
    expect((await grantStore.findById(first.json.id))?.status).toBe('approved')
  })

  it('does not replace an unrelated permission or share a reference across requesters', async () => {
    const broad = await call(direct, body())
    await approveGrant(broad.json.grant_id, owner, grantStore)
    const request = body({ grant_type: 'once', reference: 'status:v1' })
    const first = await call(direct, request)
    expect(first.status).toBe(202)
    expect(first.json.grant_id).not.toBe(broad.json.grant_id)
    const second = await call(other, request)
    expect(second.status).toBe(202)
    expect(second.json.grant_id).not.toBe(first.json.grant_id)
  })
})

describe('requester withdrawal by reference (issue 1536)', () => {
  const archive = body({ name: 'document-export', argv: ['render', 'report-7'], grant_type: 'once', reference: 'report-7:v1', batch: { id: 'reports' } })
  const viaPath = (federated: boolean) => ({
    submit: federated ? viaBroker : (input: unknown) => call(direct, input),
    withdraw: (input: unknown) => federated ? call(podAgent, input, '/pods/grants/withdraw') : call(direct, input, '/grants/withdraw'),
  })

  it.each([false, true])('withdraws a pending request, refuses its approval and execution, and repeats as a no-op (brokered: %s)', async (federated) => {
    const { submit, withdraw } = viaPath(federated)
    const pending = await submit(archive)
    expect(pending.status).toBe(202)
    const id = pending.json.grant_id

    const answer = await withdraw({ reference: 'report-7:v1', reason: 'Mail left the Inbox' })
    expect(answer).toMatchObject({ status: 200, json: { outcome: 'withdrawn', grant_id: id, previous_status: 'pending' } })
    expect(await grantStore.findById(id)).toMatchObject({ status: 'withdrawn', withdraw_reason: 'Mail left the Inbox' })
    await expect(approveGrant(id, owner, grantStore)).rejects.toThrow('not pending')
    expect(await grantStore.findPending()).toEqual([])
    // The same reference never comes back: execution is refused with the terminal state.
    expect(await submit(archive)).toMatchObject({ status: 403, json: { state: 'withdrawn', grant_id: id } })

    expect((await withdraw({ reference: 'report-7:v1' })).json).toEqual({ outcome: 'withdrawn', grant_id: id, previous_status: 'withdrawn' })
    expect((await grantStore.findById(id))?.withdraw_reason).toBe('Mail left the Inbox')
    expect(await grantStore.findByRequester(federated ? podAgent : direct)).toHaveLength(1)
  })

  it('removes the request from the batch\'s pending members', async () => {
    const pending = await call(direct, archive)
    const other = await call(direct, { ...archive, argv: ['render', 'report-8'], reference: 'report-8:v1' })
    await call(direct, { reference: 'report-7:v1' }, '/grants/withdraw')
    const members = await fetch(`${base}/grants?${new URLSearchParams({ requester: direct, batch: 'reports', status: 'pending' })}`, { headers: { Authorization: `Bearer ${direct}` } })
    expect((await members.json() as { data: { id: string }[] }).data.map(grant => grant.id)).toEqual([other.json.grant_id])
    expect(pending.json.grant_id).not.toBe(other.json.grant_id)
  })

  it.each([false, true])('withdraws an approved but unused single-use grant (brokered: %s)', async (federated) => {
    const { submit, withdraw } = viaPath(federated)
    const pending = await submit(archive)
    await approveGrant(pending.json.grant_id, owner, grantStore)
    expect((await withdraw({ reference: 'report-7:v1' })).json).toEqual({ outcome: 'withdrawn', grant_id: pending.json.grant_id, previous_status: 'approved' })
    expect(await submit(archive)).toMatchObject({ status: 403, json: { state: 'withdrawn' } })
    expect(tokensRecorded).not.toHaveBeenCalled()
  })

  it('refuses to redeem a token of a grant withdrawn after it was issued', async () => {
    const created = await call(direct, { requester: direct, target_host: 'fixture', audience: 'shapes', command: ['export', 'document-42'], grant_type: 'once', reference: 'document-42:v1' }, '/grants')
    const approved = await approveGrant(created.json.id, owner, grantStore)
    const { issueAuthzJWT } = await import('@openape/grants')
    const token = await issueAuthzJWT(approved, issuer, keys.privateKey)
    await call(direct, { reference: 'document-42:v1' }, '/grants/withdraw')
    const redeemed = await fetch(`${base}/grants/${created.json.id}/consume`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    expect(await redeemed.json()).toMatchObject({ error: 'withdrawn', status: 'withdrawn' })
    expect((await grantStore.findById(created.json.id))?.status).toBe('withdrawn')
  })

  it('reports a used request as already decided and changes nothing', async () => {
    const pending = await call(direct, archive)
    await approveGrant(pending.json.grant_id, owner, grantStore)
    expect((await call(direct, archive)).status).toBe(200)
    expect((await call(direct, { reference: 'report-7:v1' }, '/grants/withdraw')).json).toEqual({ outcome: 'already_decided', grant_id: pending.json.grant_id, status: 'used' })
    expect((await grantStore.findById(pending.json.grant_id))?.status).toBe('used')
  })

  it('never reaches another requester\'s or another binding\'s request', async () => {
    const mine = await call(direct, archive)
    const brokeredRequest = await viaBroker(archive)
    // Another subject, the same subject without its broker binding, and an unknown reference all answer unknown.
    expect((await call(other, { reference: 'report-7:v1' }, '/grants/withdraw')).json).toEqual({ outcome: 'unknown' })
    expect((await call(podAgent, { reference: 'report-7:v1' }, '/grants/withdraw')).json).toEqual({ outcome: 'unknown' })
    expect((await call(direct, { reference: 'report-9:v1' }, '/grants/withdraw')).json).toEqual({ outcome: 'unknown' })
    expect((await grantStore.findById(mine.json.grant_id))?.status).toBe('pending')
    expect((await grantStore.findById(brokeredRequest.json.grant_id))?.status).toBe('pending')
  })

  it('refuses unauthenticated, delegated-shape and malformed withdrawals before touching a request', async () => {
    const pending = await call(direct, archive)
    expect((await call(null, { reference: 'report-7:v1' }, '/grants/withdraw')).status).toBe(401)
    for (const input of [{}, { reference: '' }, { reference: 'report-7:v1', grant_id: pending.json.grant_id }, { reference: 'report-7:v1', reason: 'a\u0000b' }, 'not json'])
      expect((await call(direct, input, '/grants/withdraw')).status, JSON.stringify(input)).toBe(400)
    expect((await call(inactive, { reference: 'report-7:v1' }, '/grants/withdraw')).status).toBe(403)
    expect((await grantStore.findById(pending.json.grant_id))?.status).toBe('pending')
  })

  it('refuses at the broker when the decision IdP does not support withdrawal, without any fallback', async () => {
    const pending = await viaBroker(archive)
    withdrawSupported = false
    const refused = await call(podAgent, { reference: 'report-7:v1' }, '/pods/grants/withdraw')
    expect(refused.status).toBe(501)
    expect((await grantStore.findById(pending.json.grant_id))?.status).toBe('pending')
  })
})
