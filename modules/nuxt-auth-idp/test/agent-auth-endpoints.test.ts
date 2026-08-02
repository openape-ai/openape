// Security checklist: legacy agent challenge-response aliases
// (/api/agent/challenge + /api/agent/authenticate) — inactive users are
// rejected, challenges are single-use, signatures verified against real
// ed25519 keys.

import { decodeJwt } from 'jose'
import { createStorage } from 'unstorage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), opts),
}))

const AGENT = 'bot@example.com'
const OWNER = 'owner@example.com'

async function seedAgent(overrides: Record<string, unknown> = {}) {
  const { createUserStore } = await import('../src/runtime/server/utils/user-store')
  await createUserStore().create({
    email: AGENT,
    name: 'Bot',
    isActive: true,
    owner: OWNER,
    createdAt: Date.now(),
    ...overrides,
  } as any)
}

async function seedKey(key: { publicKeySsh: string }) {
  const { createSshKeyStore } = await import('../src/runtime/server/utils/ssh-key-store')
  await createSshKeyStore().save({
    keyId: `key-${Math.random()}`,
    userEmail: AGENT,
    publicKey: key.publicKeySsh,
    name: 'test',
    createdAt: Date.now(),
  })
}

async function requestChallenge() {
  const { default: handler } = await import('../src/runtime/server/api/agent/challenge.post')
  const result = await handler({ body: { agent_id: AGENT } } as any)
  return result.challenge
}

async function authenticate(body: Record<string, unknown>) {
  const { default: handler } = await import('../src/runtime/server/api/agent/authenticate.post')
  return handler({ body } as any)
}

describe('legacy agent auth endpoints', () => {
  beforeEach(async () => {
    for (const storage of storages.values()) await storage.clear()
  })

  it('challenge rejects a missing agent_id', async () => {
    const { default: handler } = await import('../src/runtime/server/api/agent/challenge.post')
    await expect(handler({ body: {} } as any)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('challenge returns 404 for an identity without SSH keys', async () => {
    await seedAgent()
    const { default: handler } = await import('../src/runtime/server/api/agent/challenge.post')
    await expect(handler({ body: { agent_id: AGENT } } as any)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('authenticate rejects missing fields', async () => {
    await expect(authenticate({ agent_id: AGENT, challenge: 'x' }))
      .rejects
      .toMatchObject({ statusCode: 400 })
  })

  it('challenge rejects an inactive user even with SSH keys', async () => {
    const key = generateSshEd25519Key()
    await seedAgent({ isActive: false })
    await seedKey(key)
    const { default: handler } = await import('../src/runtime/server/api/agent/challenge.post')
    await expect(handler({ body: { agent_id: AGENT } } as any))
      .rejects
      .toMatchObject({ statusCode: 404, statusMessage: 'User not found or inactive' })
  })

  it('authenticate rejects an inactive user even with valid keys', async () => {
    const key = generateSshEd25519Key()
    await seedAgent({ isActive: false })
    await seedKey(key)
    // Mint the challenge directly — the challenge route refuses inactive users
    const { useGrantStores } = await import('../src/runtime/server/utils/grant-stores')
    const challenge = await useGrantStores().challengeStore.createChallenge(AGENT)
    await expect(authenticate({
      agent_id: AGENT,
      challenge,
      signature: key.sign(challenge).toString('base64'),
    })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('authenticate issues an act=agent token for an owned user', async () => {
    const key = generateSshEd25519Key()
    await seedAgent()
    await seedKey(key)
    const challenge = await requestChallenge()
    const result = await authenticate({
      agent_id: AGENT,
      challenge,
      signature: key.sign(challenge).toString('base64'),
    })
    expect(result.agent_id).toBe(AGENT)
    const payload = decodeJwt(result.token)
    expect(payload.act).toBe('agent')
    expect(payload.iss).toBe(ISSUER)
    expect(payload.aud).toBe('apes-cli')
  })

  it('authenticate rejects a signature from a different key', async () => {
    const key = generateSshEd25519Key()
    const wrongKey = generateSshEd25519Key()
    await seedAgent()
    await seedKey(key)
    const challenge = await requestChallenge()
    await expect(authenticate({
      agent_id: AGENT,
      challenge,
      signature: wrongKey.sign(challenge).toString('base64'),
    })).rejects.toMatchObject({ statusCode: 401, statusMessage: 'Invalid signature' })
  })

  it('authenticate enforces single-use challenges', async () => {
    const key = generateSshEd25519Key()
    await seedAgent()
    await seedKey(key)
    const challenge = await requestChallenge()
    const signature = key.sign(challenge).toString('base64')
    await authenticate({ agent_id: AGENT, challenge, signature })
    await expect(authenticate({ agent_id: AGENT, challenge, signature }))
      .rejects
      .toMatchObject({ statusCode: 401 })
  })
})
