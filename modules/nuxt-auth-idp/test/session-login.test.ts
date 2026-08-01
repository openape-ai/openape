// Security checklist: browser session login (/api/session/login) — same
// challenge-response guarantees as the token flow, plus SSHSIG envelope
// verification (ssh-keygen -Y sign) with namespace binding.

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

const sessionData: Record<string, unknown> = {}
const sessionUpdate = vi.fn(async (data: Record<string, unknown>) => Object.assign(sessionData, data))

vi.mock('../src/runtime/server/utils/session', () => ({
  getAppSession: async () => ({ data: sessionData, update: sessionUpdate }),
}))

const USER = 'human@example.com'

async function seed(key: { publicKeySsh: string }) {
  const { createUserStore } = await import('../src/runtime/server/utils/user-store')
  const { createSshKeyStore } = await import('../src/runtime/server/utils/ssh-key-store')
  await createUserStore().create({ email: USER, name: 'Test', isActive: true, createdAt: Date.now() } as any)
  await createSshKeyStore().save({
    keyId: `key-${Math.random()}`,
    userEmail: USER,
    publicKey: key.publicKeySsh,
    name: 'test',
    createdAt: Date.now(),
  })
}

async function requestChallenge(): Promise<string> {
  const { default: handler } = await import('../src/runtime/server/api/auth/challenge.post')
  const result = await handler({ body: { id: USER } } as any)
  return result.challenge
}

async function login(body: Record<string, unknown>) {
  const { default: handler } = await import('../src/runtime/server/api/session/login.post')
  return handler({ body } as any)
}

describe('session login endpoint', () => {
  beforeEach(async () => {
    for (const storage of storages.values()) await storage.clear()
    for (const key of Object.keys(sessionData)) delete sessionData[key]
    sessionUpdate.mockClear()
  })

  it('rejects missing fields', async () => {
    await expect(login({ id: USER })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects an unknown user', async () => {
    await expect(login({ id: USER, challenge: 'x'.repeat(64), signature: 'sig' }))
      .rejects
      .toMatchObject({ statusCode: 404 })
  })

  it('establishes a session on a valid raw ed25519 signature', async () => {
    const key = generateSshEd25519Key()
    await seed(key)
    const challenge = await requestChallenge()
    const result = await login({
      id: USER,
      challenge,
      signature: key.sign(challenge).toString('base64'),
    })
    expect(result).toEqual({ ok: true })
    expect(sessionUpdate).toHaveBeenCalledWith({ userId: USER })
  })

  it('establishes a session on a valid SSHSIG envelope', async () => {
    const key = generateSshEd25519Key()
    await seed(key)
    const challenge = await requestChallenge()
    const result = await login({
      id: USER,
      challenge,
      signature: key.signSshSig(challenge, 'openape'),
    })
    expect(result).toEqual({ ok: true })
    expect(sessionData.userId).toBe(USER)
  })

  it('rejects an SSHSIG envelope signed for a different namespace', async () => {
    const key = generateSshEd25519Key()
    await seed(key)
    const challenge = await requestChallenge()
    await expect(login({
      id: USER,
      challenge,
      signature: key.signSshSig(challenge, 'file'),
    })).rejects.toMatchObject({ statusCode: 401, statusMessage: 'Invalid signature' })
    expect(sessionUpdate).not.toHaveBeenCalled()
  })

  it('enforces single-use challenges for session login', async () => {
    const key = generateSshEd25519Key()
    await seed(key)
    const challenge = await requestChallenge()
    const signature = key.sign(challenge).toString('base64')
    await login({ id: USER, challenge, signature })
    await expect(login({ id: USER, challenge, signature }))
      .rejects
      .toMatchObject({ statusCode: 401 })
  })

  it('does not establish a session on an invalid signature', async () => {
    const key = generateSshEd25519Key()
    const wrongKey = generateSshEd25519Key()
    await seed(key)
    const challenge = await requestChallenge()
    await expect(login({
      id: USER,
      challenge,
      signature: wrongKey.sign(challenge).toString('base64'),
    })).rejects.toMatchObject({ statusCode: 401 })
    expect(sessionUpdate).not.toHaveBeenCalled()
  })
})
