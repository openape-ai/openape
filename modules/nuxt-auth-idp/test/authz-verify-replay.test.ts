// Security checklist: authz-JWT verification endpoint — signature check,
// grant status gating, and once-grant replay protection: the first verify
// consumes the grant, a second verify of the same token must fail.

import { issueAuthzJWT, InMemoryGrantStore  } from '@openape/grants'
import { generateKeyPair, SignJWT } from 'jose'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const ISSUER = 'https://id.openape.test'

let grantStore = new InMemoryGrantStore()
let keys: Awaited<ReturnType<typeof generateKeyPair>>

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  readBody: async (event: any) => event.body,
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), opts),
}))

vi.mock('../src/runtime/server/utils/grant-stores', () => ({
  useGrantStores: () => ({ grantStore }),
}))

vi.mock('../src/runtime/server/utils/stores', () => ({
  getIdpIssuer: () => ISSUER,
  useIdpStores: () => ({
    keyStore: {
      getSigningKey: async () => ({ kid: 'k1', privateKey: keys.privateKey, publicKey: keys.publicKey }),
    },
  }),
}))

async function seedApprovedGrant(grantType: 'once' | 'always', id: string) {
  const grant = {
    id,
    status: 'approved' as const,
    created_at: Math.floor(Date.now() / 1000),
    decided_at: Math.floor(Date.now() / 1000),
    request: {
      requester: 'agent@example.com',
      target_host: 'macmini',
      audience: 'shapes',
      grant_type: grantType,
      permissions: ['gh.repo[*]#list'],
    },
  }
  await grantStore.save(grant as any)
  return grant
}

async function verify(token: unknown) {
  const { default: handler } = await import('../src/runtime/server/api/grants/verify.post')
  return handler({ body: { token } } as any)
}

describe('grant verify endpoint (authz JWT)', () => {
  beforeAll(async () => {
    keys = await generateKeyPair('EdDSA')
  })

  beforeEach(() => {
    grantStore = new InMemoryGrantStore()
  })

  it('rejects a missing token', async () => {
    const result = await verify(undefined)
    expect(result).toMatchObject({ valid: false, error: 'Missing token' })
  })

  it('rejects a garbage token', async () => {
    const result = await verify('not-a-jwt')
    expect(result.valid).toBe(false)
  })

  it('rejects a token signed with a foreign key', async () => {
    const grant = await seedApprovedGrant('always', 'g-foreign')
    const foreign = await generateKeyPair('EdDSA')
    const token = await issueAuthzJWT(grant as any, ISSUER, foreign.privateKey)
    const result = await verify(token)
    expect(result.valid).toBe(false)
  })

  it('rejects a valid JWT without a grant_id claim', async () => {
    const token = await new SignJWT({ sub: 'agent@example.com' })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(keys.privateKey)
    const result = await verify(token)
    expect(result).toMatchObject({ valid: false, error: 'Missing grant_id in token' })
  })

  it('rejects a token whose grant no longer exists', async () => {
    const grant = await seedApprovedGrant('once', 'g-gone')
    const token = await issueAuthzJWT(grant as any, ISSUER, keys.privateKey, 'k1')
    grantStore = new InMemoryGrantStore() // grant vanished
    const result = await verify(token)
    expect(result).toMatchObject({ valid: false, error: 'Grant not found' })
  })

  it('consumes a once-grant on first verify and rejects the replay', async () => {
    const grant = await seedApprovedGrant('once', 'g-once')
    const token = await issueAuthzJWT(grant as any, ISSUER, keys.privateKey, 'k1')

    const first = await verify(token)
    expect(first.valid).toBe(true)
    expect(first.claims?.grant_id).toBe('g-once')
    expect(first.grant.status).toBe('used')

    // Same still-valid JWT, second use — must fail, the grant is spent
    const second = await verify(token)
    expect(second.valid).toBe(false)
    expect(second.error).toContain('not approved')
  })

  it('keeps an always-grant valid across repeated verifies', async () => {
    const grant = await seedApprovedGrant('always', 'g-always')
    const token = await issueAuthzJWT(grant as any, ISSUER, keys.privateKey, 'k1')

    const first = await verify(token)
    const second = await verify(token)
    expect(first.valid).toBe(true)
    expect(second.valid).toBe(true)
    expect(second.grant.status).toBe('approved')
  })

  it('rejects a revoked grant even with a valid JWT', async () => {
    const grant = await seedApprovedGrant('always', 'g-revoked')
    const token = await issueAuthzJWT(grant as any, ISSUER, keys.privateKey, 'k1')
    await grantStore.updateStatus('g-revoked', 'revoked')

    const result = await verify(token)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('not approved')
  })
})
