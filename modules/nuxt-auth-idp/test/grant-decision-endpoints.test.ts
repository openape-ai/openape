// Security checklist: grant lifecycle authorization — who may deny or
// revoke a grant (requester, owner/approver, admin — nobody else), and
// the authz-JWT issuance endpoint (identity binding, approved-only).

import { verifyAuthzJWT, InMemoryGrantStore  } from '@openape/grants'
import { generateKeyPair } from 'jose'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const ISSUER = 'https://id.openape.test'

let grantStore = new InMemoryGrantStore()
let keys: Awaited<ReturnType<typeof generateKeyPair>>

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  readBody: async (event: any) => event.body,
  getRouterParam: (event: any, name: string) => event.params?.[name],
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), opts),
}))

vi.mock('../src/runtime/server/utils/grant-stores', () => ({
  useGrantStores: () => ({ grantStore }),
}))

const users = new Map<string, Record<string, unknown>>()
vi.mock('../src/runtime/server/utils/stores', () => ({
  getIdpIssuer: () => ISSUER,
  useIdpStores: () => ({
    userStore: { findByEmail: async (email: string) => users.get(email) ?? null },
    keyStore: {
      getSigningKey: async () => ({ kid: 'k1', privateKey: keys.privateKey, publicKey: keys.publicKey }),
    },
  }),
}))

let authedUser = 'requester@example.com'
let adminUser: string | null = null
vi.mock('../src/runtime/server/utils/admin', () => ({
  requireAuth: async () => authedUser,
  isAdmin: (email: string) => email === adminUser,
}))

let bearerPayload: { sub: string, act: string } | null = null
vi.mock('../src/runtime/server/utils/agent-auth', () => ({
  tryBearerAuth: async () => bearerPayload,
}))

vi.mock('../src/runtime/server/utils/session', () => ({
  getAppSession: async () => ({ data: {} }),
}))

const REQUESTER = 'requester@example.com'

async function seedGrant(status: 'pending' | 'approved' | 'denied' = 'pending', id = 'grant-1') {
  await grantStore.save({
    id,
    status,
    created_at: Math.floor(Date.now() / 1000),
    request: {
      requester: REQUESTER,
      target_host: 'macmini',
      audience: 'shapes',
      grant_type: 'once',
      permissions: ['gh.repo[*]#list'],
    },
  } as any)
}

describe('grant decision endpoints', () => {
  beforeAll(async () => {
    keys = await generateKeyPair('EdDSA')
  })

  beforeEach(() => {
    grantStore = new InMemoryGrantStore()
    users.clear()
    authedUser = REQUESTER
    adminUser = null
    bearerPayload = null
  })

  describe('deny', () => {
    async function deny(id = 'grant-1') {
      const { default: handler } = await import('../src/runtime/server/api/grants/[id]/deny.post')
      return handler({ params: { id } } as any)
    }

    it('lets the requester deny their own pending grant', async () => {
      await seedGrant()
      users.set(REQUESTER, { email: REQUESTER })
      const denied = await deny()
      expect(denied.status).toBe('denied')
      expect(denied.decided_by).toBe(REQUESTER)
    })

    it('lets the owner of the requesting agent deny', async () => {
      await seedGrant()
      users.set(REQUESTER, { email: REQUESTER, owner: 'owner@example.com' })
      authedUser = 'owner@example.com'
      const denied = await deny()
      expect(denied.status).toBe('denied')
      expect(denied.decided_by).toBe('owner@example.com')
    })

    it('lets the approver of the requesting agent deny', async () => {
      await seedGrant()
      users.set(REQUESTER, { email: REQUESTER, approver: 'approver@example.com' })
      authedUser = 'approver@example.com'
      const denied = await deny()
      expect(denied.status).toBe('denied')
    })

    it('rejects an unrelated user', async () => {
      await seedGrant()
      users.set(REQUESTER, { email: REQUESTER, owner: 'owner@example.com' })
      authedUser = 'stranger@example.com'
      await expect(deny()).rejects.toMatchObject({ statusCode: 403 })
    })

    it('rejects when the requester user record is missing', async () => {
      await seedGrant()
      authedUser = 'stranger@example.com'
      await expect(deny()).rejects.toMatchObject({ statusCode: 403 })
    })

    it('rejects denying an already-decided grant', async () => {
      await seedGrant('approved')
      users.set(REQUESTER, { email: REQUESTER })
      await expect(deny()).rejects.toMatchObject({ statusCode: 400 })
    })

    it('returns 404 for an unknown grant', async () => {
      await expect(deny('missing')).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe('revoke', () => {
    async function revoke(id = 'grant-1') {
      const { default: handler } = await import('../src/runtime/server/api/grants/[id]/revoke.post')
      return handler({ params: { id } } as any)
    }

    it('lets the requester revoke via bearer token', async () => {
      await seedGrant('approved')
      bearerPayload = { sub: REQUESTER, act: 'agent' }
      const revoked = await revoke()
      expect(revoked.status).toBe('revoked')
    })

    it('lets the approver revoke', async () => {
      await seedGrant('approved')
      users.set(REQUESTER, { email: REQUESTER, approver: 'approver@example.com' })
      authedUser = 'approver@example.com'
      const revoked = await revoke()
      expect(revoked.status).toBe('revoked')
    })

    it('lets an admin revoke', async () => {
      await seedGrant('approved')
      authedUser = 'admin@example.com'
      adminUser = 'admin@example.com'
      const revoked = await revoke()
      expect(revoked.status).toBe('revoked')
    })

    it('rejects an unrelated non-admin user', async () => {
      await seedGrant('approved')
      authedUser = 'stranger@example.com'
      await expect(revoke()).rejects.toMatchObject({ statusCode: 403 })
    })

    it('rejects revoking an already-denied grant', async () => {
      await seedGrant('denied')
      bearerPayload = { sub: REQUESTER, act: 'agent' }
      await expect(revoke()).rejects.toMatchObject({ statusCode: 400 })
    })
  })

  describe('token issuance ([id]/token)', () => {
    async function issueToken(id = 'grant-1') {
      const { default: handler } = await import('../src/runtime/server/api/grants/[id]/token.post')
      return handler({ params: { id } } as any)
    }

    it('issues a verifiable authz JWT for the requester of an approved grant', async () => {
      await seedGrant('approved')
      bearerPayload = { sub: REQUESTER, act: 'agent' }
      const result = await issueToken()
      expect(result.grant.id).toBe('grant-1')

      const verification = await verifyAuthzJWT(result.authz_jwt, { publicKey: keys.publicKey })
      expect(verification.valid).toBe(true)
      expect(verification.claims?.grant_id).toBe('grant-1')
    })

    it('rejects a caller that is not the grant requester', async () => {
      await seedGrant('approved')
      bearerPayload = { sub: 'other@example.com', act: 'agent' }
      await expect(issueToken()).rejects.toMatchObject({ statusCode: 403 })
    })

    it('rejects a grant that is not approved', async () => {
      await seedGrant('pending')
      bearerPayload = { sub: REQUESTER, act: 'agent' }
      await expect(issueToken()).rejects.toMatchObject({ statusCode: 400 })
    })

    it('rejects unauthenticated callers', async () => {
      await seedGrant('approved')
      await expect(issueToken()).rejects.toMatchObject({ statusCode: 401 })
    })

    it('returns 404 for an unknown grant', async () => {
      bearerPayload = { sub: REQUESTER, act: 'agent' }
      await expect(issueToken('missing')).rejects.toMatchObject({ statusCode: 404 })
    })
  })
})
