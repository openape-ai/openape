// Security checklist: single-use + TTL semantics of the unstorage-backed
// stores — WebAuthn challenges, OAuth codes (replay protection), JWT jti
// replay markers, and the grant/auth challenge store (identity binding).

import { createStorage } from 'unstorage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storages = new Map<string, ReturnType<typeof createStorage>>()

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({
    openapeIdp: { storageKey: 'idp' },
    openapeGrants: { storageKey: 'grants' },
  }),
  useEvent: () => undefined,
  useStorage: (key: string) => {
    if (!storages.has(key)) storages.set(key, createStorage())
    return storages.get(key)!
  },
}))

beforeEach(async () => {
  for (const storage of storages.values()) await storage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('webauthn challenge store', () => {
  async function makeStore() {
    const { createChallengeStore } = await import('../src/runtime/server/utils/challenge-store')
    return createChallengeStore()
  }

  it('find returns a live challenge and null after expiry', async () => {
    vi.useFakeTimers()
    const store = await makeStore()
    await store.save('tok', { challenge: 'abc', expiresAt: Date.now() + 60_000 } as any)
    expect((await store.find('tok'))?.challenge).toBe('abc')

    vi.advanceTimersByTime(61_000)
    expect(await store.find('tok')).toBeNull()
    // Expired entries are removed, not just hidden
    vi.setSystemTime(Date.now() - 120_000)
    expect(await store.find('tok')).toBeNull()
  })

  it('consume returns the challenge exactly once', async () => {
    const store = await makeStore()
    await store.save('tok', { challenge: 'abc', expiresAt: Date.now() + 60_000 } as any)
    expect((await store.consume('tok'))?.challenge).toBe('abc')
    expect(await store.consume('tok')).toBeNull()
  })

  it('consume refuses an expired challenge', async () => {
    vi.useFakeTimers()
    const store = await makeStore()
    await store.save('tok', { challenge: 'abc', expiresAt: Date.now() + 60_000 } as any)
    vi.advanceTimersByTime(61_000)
    expect(await store.consume('tok')).toBeNull()
  })
})

describe('oauth code store', () => {
  async function makeStore() {
    const { createCodeStore } = await import('../src/runtime/server/utils/code-store')
    return createCodeStore()
  }

  it('find returns a live code and delete removes it', async () => {
    const store = await makeStore()
    await store.save({ code: 'c1', expiresAt: Date.now() + 60_000 } as any)
    expect((await store.find('c1'))?.code).toBe('c1')
    await store.delete('c1')
    expect(await store.find('c1')).toBeNull()
  })

  it('find refuses and removes an expired code', async () => {
    vi.useFakeTimers()
    const store = await makeStore()
    await store.save({ code: 'c1', expiresAt: Date.now() + 60_000 } as any)
    vi.advanceTimersByTime(61_000)
    expect(await store.find('c1')).toBeNull()
  })
})

describe('jti replay store', () => {
  async function makeStore() {
    const { createJtiStore } = await import('../src/runtime/server/utils/jti-store')
    return createJtiStore()
  }

  it('marks a jti as used until its TTL expires', async () => {
    vi.useFakeTimers()
    const store = await makeStore()
    expect(await store.hasBeenUsed('jti-1')).toBe(false)
    await store.markUsed('jti-1', 60_000)
    expect(await store.hasBeenUsed('jti-1')).toBe(true)
    vi.advanceTimersByTime(61_000)
    expect(await store.hasBeenUsed('jti-1')).toBe(false)
  })
})

describe('auth/grant challenge store', () => {
  async function makeStore() {
    const { createGrantChallengeStore } = await import('../src/runtime/server/utils/grant-challenge-store')
    return createGrantChallengeStore()
  }

  it('consume succeeds exactly once for the right identity', async () => {
    const store = await makeStore()
    const challenge = await store.createChallenge('agent@example.com')
    expect(await store.consumeChallenge(challenge, 'agent@example.com')).toBe(true)
    expect(await store.consumeChallenge(challenge, 'agent@example.com')).toBe(false)
  })

  it('a consume attempt by the wrong identity burns the challenge', async () => {
    const store = await makeStore()
    const challenge = await store.createChallenge('agent@example.com')
    expect(await store.consumeChallenge(challenge, 'attacker@example.com')).toBe(false)
    // The rightful owner cannot use it afterwards either — single shot
    expect(await store.consumeChallenge(challenge, 'agent@example.com')).toBe(false)
  })

  it('refuses an expired challenge (5 min TTL)', async () => {
    vi.useFakeTimers()
    const store = await makeStore()
    const challenge = await store.createChallenge('agent@example.com')
    vi.advanceTimersByTime(301_000)
    expect(await store.consumeChallenge(challenge, 'agent@example.com')).toBe(false)
  })

  it('refuses an unknown challenge', async () => {
    const store = await makeStore()
    expect(await store.consumeChallenge('f'.repeat(64), 'agent@example.com')).toBe(false)
  })
})
