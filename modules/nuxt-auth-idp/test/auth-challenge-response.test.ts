// Security checklist: ed25519 challenge-response — single-use challenges,
// TTL enforcement, identity binding, and signature verification on the
// /api/auth/challenge + /api/auth/authenticate flow. Uses real stores over
// in-memory unstorage and real ed25519 keys — no mock mirroring.

import { jwtVerify } from 'jose'
import { createStorage } from 'unstorage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateSshEd25519Key } from './helpers/ssh-ed25519'

const ISSUER = 'https://id.openape.test'

const storages = new Map<string, ReturnType<typeof createStorage>>()

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({
    openapeIdp: { storageKey: 'idp', issuer: ISSUER },
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
  getHeader: (event: any, name: string) => event.headers?.[name.toLowerCase()],
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), opts),
}))

const USER = 'human@example.com'

async function seedUser(email: string, overrides: Record<string, unknown> = {}) {
  const { createUserStore } = await import('../src/runtime/server/utils/user-store')
  await createUserStore().create({
    email,
    name: 'Test User',
    isActive: true,
    createdAt: Date.now(),
    ...overrides,
  } as any)
}

async function seedSshKey(email: string, publicKey: string, keyId = `key-${Math.random()}`) {
  const { createSshKeyStore } = await import('../src/runtime/server/utils/ssh-key-store')
  await createSshKeyStore().save({ keyId, userEmail: email, publicKey, name: 'test', createdAt: Date.now() })
}

async function requestChallenge(id: string): Promise<string> {
  const { default: handler } = await import('../src/runtime/server/api/auth/challenge.post')
  const result = await handler({ body: { id } } as any)
  return result.challenge
}

async function authenticate(body: Record<string, unknown>) {
  const { default: handler } = await import('../src/runtime/server/api/auth/authenticate.post')
  return handler({ body } as any)
}

describe('auth challenge-response flow', () => {
  beforeEach(async () => {
    for (const storage of storages.values()) await storage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('/api/auth/challenge', () => {
    it('rejects a request without id', async () => {
      const { default: handler } = await import('../src/runtime/server/api/auth/challenge.post')
      await expect(handler({ body: {} } as any)).rejects.toMatchObject({ statusCode: 400 })
    })

    it('returns 404 for an identity without SSH keys', async () => {
      await seedUser(USER)
      const { default: handler } = await import('../src/runtime/server/api/auth/challenge.post')
      await expect(handler({ body: { id: USER } } as any)).rejects.toMatchObject({ statusCode: 404 })
    })

    it('issues a challenge for an active user with SSH keys', async () => {
      const key = generateSshEd25519Key()
      await seedUser(USER)
      await seedSshKey(USER, key.publicKeySsh)
      const challenge = await requestChallenge(USER)
      expect(challenge).toMatch(/^[0-9a-f]{64}$/)
    })

    it('issues a challenge for an identity known only by SSH key', async () => {
      const key = generateSshEd25519Key()
      await seedSshKey('keys-only@example.com', key.publicKeySsh)
      const challenge = await requestChallenge('keys-only@example.com')
      expect(challenge).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  describe('/api/auth/authenticate', () => {
    it('rejects a request with missing fields', async () => {
      await expect(authenticate({ id: USER, challenge: 'x' }))
        .rejects
        .toMatchObject({ statusCode: 400 })
    })

    it('rejects an unknown challenge', async () => {
      const key = generateSshEd25519Key()
      await seedUser(USER)
      await seedSshKey(USER, key.publicKeySsh)
      await expect(authenticate({
        id: USER,
        challenge: 'f'.repeat(64),
        signature: key.sign('f'.repeat(64)).toString('base64'),
      })).rejects.toMatchObject({ statusCode: 401 })
    })

    it('rejects a public_key that belongs to another user', async () => {
      const keyA = generateSshEd25519Key()
      const keyB = generateSshEd25519Key()
      await seedUser(USER)
      await seedSshKey(USER, keyA.publicKeySsh)
      await seedUser('other@example.com')
      await seedSshKey('other@example.com', keyB.publicKeySsh)

      const challenge = await requestChallenge(USER)
      await expect(authenticate({
        id: USER,
        challenge,
        signature: keyB.sign(challenge).toString('base64'),
        public_key: keyB.publicKeySsh,
      })).rejects.toMatchObject({ statusCode: 404 })
    })

    it('issues a verifiable JWT with act=human on a valid signature', async () => {
      const key = generateSshEd25519Key()
      await seedUser(USER)
      await seedSshKey(USER, key.publicKeySsh)

      const challenge = await requestChallenge(USER)
      const result = await authenticate({
        id: USER,
        challenge,
        signature: key.sign(challenge).toString('base64'),
      })

      expect(result.email).toBe(USER)
      expect(result.act).toBe('human')

      const { createKeyStore } = await import('../src/runtime/server/utils/key-store')
      const signingKey = await createKeyStore().getSigningKey()
      const { payload } = await jwtVerify(result.token, signingKey.publicKey, {
        issuer: ISSUER,
        audience: 'apes-cli',
        algorithms: ['EdDSA'],
      })
      expect(payload.sub).toBe(USER)
      expect(payload.act).toBe('human')
    })

    it('issues act=agent for a user with an owner', async () => {
      const key = generateSshEd25519Key()
      await seedUser('bot@example.com', { owner: USER })
      await seedSshKey('bot@example.com', key.publicKeySsh)

      const challenge = await requestChallenge('bot@example.com')
      const result = await authenticate({
        id: 'bot@example.com',
        challenge,
        signature: key.sign(challenge).toString('base64'),
      })
      expect(result.act).toBe('agent')
    })

    it('prefers the explicit user type over ownership for the act claim', async () => {
      const key = generateSshEd25519Key()
      await seedUser('typed@example.com', { owner: USER, type: 'human' })
      await seedSshKey('typed@example.com', key.publicKeySsh)

      const challenge = await requestChallenge('typed@example.com')
      const result = await authenticate({
        id: 'typed@example.com',
        challenge,
        signature: key.sign(challenge).toString('base64'),
      })
      expect(result.act).toBe('human')
    })

    it('rejects an invalid signature', async () => {
      const key = generateSshEd25519Key()
      const wrongKey = generateSshEd25519Key()
      await seedUser(USER)
      await seedSshKey(USER, key.publicKeySsh)

      const challenge = await requestChallenge(USER)
      await expect(authenticate({
        id: USER,
        challenge,
        signature: wrongKey.sign(challenge).toString('base64'),
      })).rejects.toMatchObject({ statusCode: 401, statusMessage: 'Invalid signature' })
    })

    it('enforces single-use: a consumed challenge cannot be replayed', async () => {
      const key = generateSshEd25519Key()
      await seedUser(USER)
      await seedSshKey(USER, key.publicKeySsh)

      const challenge = await requestChallenge(USER)
      const signature = key.sign(challenge).toString('base64')
      await authenticate({ id: USER, challenge, signature })

      await expect(authenticate({ id: USER, challenge, signature }))
        .rejects
        .toMatchObject({ statusCode: 401 })
    })

    it('burns the challenge even when the signature check fails', async () => {
      const key = generateSshEd25519Key()
      const wrongKey = generateSshEd25519Key()
      await seedUser(USER)
      await seedSshKey(USER, key.publicKeySsh)

      const challenge = await requestChallenge(USER)
      await expect(authenticate({
        id: USER,
        challenge,
        signature: wrongKey.sign(challenge).toString('base64'),
      })).rejects.toMatchObject({ statusCode: 401 })

      // A correct signature afterwards must not resurrect the challenge
      await expect(authenticate({
        id: USER,
        challenge,
        signature: key.sign(challenge).toString('base64'),
      })).rejects.toMatchObject({ statusCode: 401, statusMessage: 'Invalid, expired, or already used challenge' })
    })

    it('rejects a challenge issued to a different identity', async () => {
      const keyA = generateSshEd25519Key()
      const keyB = generateSshEd25519Key()
      await seedUser(USER)
      await seedSshKey(USER, keyA.publicKeySsh)
      await seedUser('other@example.com')
      await seedSshKey('other@example.com', keyB.publicKeySsh)

      const challenge = await requestChallenge('other@example.com')
      await expect(authenticate({
        id: USER,
        challenge,
        signature: keyA.sign(challenge).toString('base64'),
      })).rejects.toMatchObject({ statusCode: 401 })
    })

    it('rejects an expired challenge (5 min TTL)', async () => {
      vi.useFakeTimers()
      const key = generateSshEd25519Key()
      await seedUser(USER)
      await seedSshKey(USER, key.publicKeySsh)

      const challenge = await requestChallenge(USER)
      vi.advanceTimersByTime(301_000)

      await expect(authenticate({
        id: USER,
        challenge,
        signature: key.sign(challenge).toString('base64'),
      })).rejects.toMatchObject({ statusCode: 401 })
    })
  })
})
