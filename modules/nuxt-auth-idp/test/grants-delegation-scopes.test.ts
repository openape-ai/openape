// Security checklist: delegation scopes for the IdP's own grants API
// (delegation.md §8). A user's agent holding a `grants:read` /
// `grants:request` delegation may read the user's grants and file requests
// for the user's agents — and nothing else. Every decision endpoint must
// refuse a delegated token (requester ≠ approver). Real token exchange,
// real auth utilities and real stores over in-memory unstorage.

import type { KeyObject } from 'node:crypto'
import { SignJWT } from 'jose'
import { createStorage } from 'unstorage'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateSshEd25519Key } from './helpers/ssh-ed25519'

const ISSUER = 'https://id.openape.test'
const OWNER = 'owner@example.com'
const POD = 'pod-upgrade@example.com'
const AGENT = 'rebase-agent@example.com'
const FOREIGN_AGENT = 'foreign-agent@example.com'

const storages = new Map<string, ReturnType<typeof createStorage>>()

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({
    openapeIdp: { storageKey: 'idp', issuer: ISSUER, managementToken: '' },
    openapeGrants: { storageKey: 'grants' },
  }),
  useEvent: () => undefined,
  useStorage: (key: string) => {
    if (!storages.has(key)) storages.set(key, createStorage())
    return storages.get(key)!
  },
}))

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  readBody: async (event: any) => event.body,
  readRawBody: async (event: any) => event.rawBody,
  getHeader: (event: any, name: string) => event.headers?.[name.toLowerCase()],
  getRequestHeader: (event: any, name: string) => event.headers?.[name.toLowerCase()],
  getQuery: (event: any) => event.query ?? {},
  getRouterParam: (event: any, name: string) => event.params?.[name],
  setResponseStatus: (event: any, status: number) => { event.status = status },
  setResponseHeader: () => {},
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), opts),
}))

// No browser session in these tests: every caller is a bearer token.
vi.mock('../src/runtime/server/utils/session', () => ({ getAppSession: async () => ({ data: {} }) }))
vi.mock('../src/runtime/server/utils/grant-pending-hooks', () => ({ runGrantPendingHooks: async () => {} }))

type Handler = (event: any) => Promise<any>

async function handler(path: string): Promise<Handler> {
  return (await import(/* @vite-ignore */ `../src/runtime/server/${path}`)).default
}

function bearer(token: string, extra: Record<string, unknown> = {}) {
  return { headers: { authorization: `Bearer ${token}` }, context: {}, ...extra }
}

async function call(path: string, token: string, extra: Record<string, unknown> = {}) {
  const event = bearer(token, extra)
  const result = await (await handler(path))(event)
  return { result, event }
}

let podKey: ReturnType<typeof generateSshEd25519Key>
let ownerToken: string
let podAgentToken: string

async function signingKey() {
  const { useIdpStores } = await import('../src/runtime/server/utils/stores')
  return useIdpStores().keyStore.getSigningKey()
}

async function directToken(sub: string, act: 'human' | 'agent') {
  const { issueAuthToken } = await import('../src/runtime/server/utils/agent-token')
  const key = await signingKey()
  return issueAuthToken({ sub, act }, ISSUER, key.privateKey, key.kid)
}

async function createDelegation(body: Record<string, unknown>) {
  return call('api/delegations/index.post', ownerToken, { body: { delegate: POD, audience: ISSUER, grant_type: 'always', ...body } })
}

async function delegatedToken(delegationGrant: string, audience = ISSUER): Promise<string> {
  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuer(POD)
    .setSubject(POD)
    .setAudience(`${ISSUER}/token`)
    .setIssuedAt()
    .setExpirationTime('60s')
    .setJti(crypto.randomUUID())
    .sign(podKey.privateKey as KeyObject)
  const rawBody = new URLSearchParams({
    grant_type: 'client_credentials',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion,
    delegation_grant: delegationGrant,
    audience,
  }).toString()
  const { result } = await call('routes/token.post', '', { headers: { 'content-type': 'application/x-www-form-urlencoded' }, rawBody })
  expect(result.access_token, JSON.stringify(result)).toBeTypeOf('string')
  return result.access_token
}

async function grantsDelegate(scopes: string[]) {
  const { result: delegation } = await createDelegation({ scopes })
  return { delegation, token: await delegatedToken(delegation.id) }
}

async function seedAgentRequest(requester = AGENT) {
  const { useGrantStores } = await import('../src/runtime/server/utils/grant-stores')
  const { createGrant } = await import('@openape/grants')
  return createGrant({ requester, target_host: 'macmini', audience: 'shapes', grant_type: 'once', command: ['git', 'status'] }, useGrantStores().grantStore)
}

async function storedGrant(id: string) {
  const { useGrantStores } = await import('../src/runtime/server/utils/grant-stores')
  return useGrantStores().grantStore.findById(id)
}

const agentRequest = { requester: AGENT, target_host: 'macmini', audience: 'shapes', grant_type: 'always', command: ['git', 'fetch'] }

describe('grants delegation scopes', () => {
  beforeAll(async () => {
    podKey = generateSshEd25519Key(POD)
    const { createUserStore } = await import('../src/runtime/server/utils/user-store')
    const { createSshKeyStore } = await import('../src/runtime/server/utils/ssh-key-store')
    const users = createUserStore()
    const now = Date.now()
    await users.create({ email: OWNER, name: 'Owner', type: 'human', isActive: true, createdAt: now })
    await users.create({ email: POD, name: 'Upgrade Pod', type: 'agent', owner: OWNER, approver: OWNER, isActive: true, createdAt: now })
    await users.create({ email: AGENT, name: 'Rebase agent', type: 'agent', owner: OWNER, approver: OWNER, isActive: true, createdAt: now })
    await users.create({ email: FOREIGN_AGENT, name: 'Foreign', type: 'agent', owner: 'other@example.com', isActive: true, createdAt: now })
    await createSshKeyStore().save({ keyId: 'pod-key', userEmail: POD, publicKey: podKey.publicKeySsh, name: 'pod', createdAt: now })
    ownerToken = await directToken(OWNER, 'human')
    podAgentToken = await directToken(POD, 'agent')
  })

  beforeEach(async () => {
    await storages.get('grants')?.clear()
  })

  describe('creating a grants delegation', () => {
    it('accepts both scopes for an own agent with the IdP as audience', async () => {
      const { result, event } = await createDelegation({ scopes: ['grants:read', 'grants:request'] })
      expect(event.status).toBe(201)
      expect(result.request).toMatchObject({ delegator: OWNER, delegate: POD, audience: ISSUER, scopes: ['grants:read', 'grants:request'] })
    })

    it.each([
      ['another audience', { audience: 'sp.example.com', scopes: ['grants:read'] }],
      ['a wildcard audience', { audience: '*', scopes: ['grants:read'] }],
      ['another user\'s agent', { delegate: FOREIGN_AGENT, scopes: ['grants:request'] }],
      ['the delegator itself', { delegate: OWNER, scopes: ['grants:read'] }],
      ['a decision scope', { scopes: ['grants:read', 'grants:approve'] }],
    ])('refuses grants scopes for %s', async (_case, body) => {
      await expect(createDelegation(body)).rejects.toMatchObject({ statusCode: 400 })
    })

    it('refuses creation with a delegated token — no chaining', async () => {
      const { token } = await grantsDelegate(['grants:read', 'grants:request'])
      await expect(call('api/delegations/index.post', token, { body: { delegate: AGENT, audience: ISSUER, scopes: ['grants:read'] } }))
        .rejects
        .toMatchObject({ statusCode: 403 })
    })
  })

  describe('grants:read', () => {
    it('lists the delegator\'s grants, including those of the delegator\'s agents', async () => {
      const seeded = await seedAgentRequest()
      const { token } = await grantsDelegate(['grants:read'])
      const { result } = await call('api/grants/index.get', token)
      expect(result.data.map((g: { id: string }) => g.id)).toContain(seeded.id)
    })

    it('lists the delegator\'s standing grants', async () => {
      const { result: standing } = await call('api/standing-grants/index.post', ownerToken, {
        body: { delegate: AGENT, audience: 'shapes', cli_id: 'git', resource_chain_template: [{ resource: 'repo' }] },
      })
      const { token } = await grantsDelegate(['grants:read'])
      const { result } = await call('api/standing-grants/index.get', token)
      expect(result.map((g: { id: string }) => g.id)).toEqual([standing.id])
    })

    it('stops working as soon as the delegation is revoked', async () => {
      const { delegation, token } = await grantsDelegate(['grants:read'])
      await call('api/delegations/[id].delete', ownerToken, { params: { id: delegation.id } })
      await expect(call('api/grants/index.get', token)).rejects.toMatchObject({ statusCode: 403 })
    })

    it('does not allow filing requests', async () => {
      const { token } = await grantsDelegate(['grants:read'])
      await expect(call('api/grants/index.post', token, { body: { ...agentRequest } })).rejects.toMatchObject({ statusCode: 403 })
    })
  })

  describe('grants:request', () => {
    it('files a pending request for an own agent and records the submitting delegate', async () => {
      const { delegation, token } = await grantsDelegate(['grants:request'])
      const { result, event } = await call('api/grants/index.post', token, { body: { ...agentRequest, submitted_by: { delegate: 'spoofed', delegation_grant: 'x' } } })
      expect(event.status).toBe(201)
      expect(result).toMatchObject({ status: 'pending', request: { requester: AGENT, submitted_by: { delegate: POD, delegation_grant: delegation.id } } })
    })

    it('never lets an existing approval settle the request', async () => {
      const { useGrantStores } = await import('../src/runtime/server/utils/grant-stores')
      const { approveGrant } = await import('@openape/grants')
      const { result: reusable } = await call('api/grants/index.post', await directToken(AGENT, 'agent'), { body: { ...agentRequest } })
      await approveGrant(reusable.id, OWNER, useGrantStores().grantStore)
      const { result: reused } = await call('api/grants/index.post', await directToken(AGENT, 'agent'), { body: { ...agentRequest } })
      expect(reused.id).toBe(reusable.id)

      const { token } = await grantsDelegate(['grants:request'])
      const { result } = await call('api/grants/index.post', token, { body: { ...agentRequest } })
      expect(result.status).toBe('pending')
      expect(result.id).not.toBe(reusable.id)
    })

    it.each([
      ['another user\'s agent', FOREIGN_AGENT],
      ['the delegator itself', OWNER],
      ['an unknown identity', 'nobody@example.com'],
    ])('refuses a request for %s', async (_case, requester) => {
      const { token } = await grantsDelegate(['grants:request'])
      await expect(call('api/grants/index.post', token, { body: { ...agentRequest, requester } })).rejects.toMatchObject({ statusCode: 403 })
    })

    it('refuses a request for a delegation', async () => {
      const { token } = await grantsDelegate(['grants:request'])
      await expect(call('api/grants/index.post', token, { body: { ...agentRequest, delegator: OWNER, delegate: AGENT, scopes: ['x'] } }))
        .rejects
        .toMatchObject({ statusCode: 400 })
    })

    it('does not allow reading the grant list', async () => {
      const { token } = await grantsDelegate(['grants:request'])
      await expect(call('api/grants/index.get', token)).rejects.toMatchObject({ statusCode: 403 })
    })

    it('keeps a client-supplied submitter out of a direct request', async () => {
      const { result } = await call('api/grants/index.post', podAgentToken, { body: { ...agentRequest, submitted_by: { delegate: 'spoofed', delegation_grant: 'x' } } })
      expect(result.request.requester).toBe(POD)
      expect(result.request.submitted_by).toBeUndefined()
    })
  })

  describe('decisions refuse delegated tokens', () => {
    let token: string
    let pendingId: string

    beforeEach(async () => {
      token = (await grantsDelegate(['grants:read', 'grants:request'])).token
      pendingId = (await seedAgentRequest()).id
    })

    it.each([
      ['approve', 'api/grants/[id]/approve.post', 403],
      ['deny', 'api/grants/[id]/deny.post', 403],
      ['revoke', 'api/grants/[id]/revoke.post', 403],
      ['authz token', 'api/grants/[id]/token.post', 401],
    ])('refuses %s', async (_action, path, statusCode) => {
      await expect(call(path, token, { params: { id: pendingId }, body: {} })).rejects.toMatchObject({ statusCode })
      expect((await storedGrant(pendingId))?.status).toBe('pending')
    })

    it('refuses batch decisions', async () => {
      await expect(call('api/grants/batch.post', token, { body: { operations: [{ id: pendingId, action: 'approve' }] } }))
        .rejects
        .toMatchObject({ statusCode: 403 })
      expect((await storedGrant(pendingId))?.status).toBe('pending')
    })

    it('refuses standing grant management', async () => {
      const body = { delegate: AGENT, audience: 'shapes', cli_id: 'git', resource_chain_template: [{ resource: 'repo' }] }
      await expect(call('api/standing-grants/index.post', token, { body })).rejects.toMatchObject({ statusCode: 403 })
      await expect(call('api/standing-grants/bulk-seed.post', token, { body: { delegate: AGENT } })).rejects.toMatchObject({ statusCode: 403 })
      const { result: standing } = await call('api/standing-grants/index.post', ownerToken, { body })
      await expect(call('api/standing-grants/[id].delete', token, { params: { id: standing.id } })).rejects.toMatchObject({ statusCode: 403 })
      expect((await storedGrant(standing.id))?.status).toBe('approved')
    })

    it('refuses revoking a delegation, including its own', async () => {
      const { result: own } = await createDelegation({ scopes: ['grants:read'] })
      await expect(call('api/delegations/[id].delete', token, { params: { id: own.id } })).rejects.toMatchObject({ statusCode: 403 })
      expect((await storedGrant(own.id))?.status).toBe('approved')
    })

    it('refuses a delegated token minted for the CLI audience from a wildcard delegation', async () => {
      // Before delegation.md §8 a wildcard delegation could mint an
      // `apes-cli` token whose `sub` is the delegator, and the IdP took it
      // as the delegator on every endpoint — including approve.
      const { result: wildcard } = await createDelegation({ audience: '*', scopes: undefined })
      const cliToken = await delegatedToken(wildcard.id, 'apes-cli')
      await expect(call('api/grants/[id]/approve.post', cliToken, { params: { id: pendingId }, body: {} })).rejects.toMatchObject({ statusCode: 403 })
      await expect(call('api/grants/index.get', cliToken)).rejects.toMatchObject({ statusCode: 401 })
      expect((await storedGrant(pendingId))?.status).toBe('pending')
    })

    it('still lets the owner approve directly', async () => {
      const { result } = await call('api/grants/[id]/approve.post', ownerToken, { params: { id: pendingId }, body: {} })
      expect(result.grant.status).toBe('approved')
    })
  })
})
