// Security checklist: refresh-token rotation — one-time-use tokens with
// reuse detection that revokes the whole family (RFC 6819 refresh-token
// replay mitigation), plus revocation and family listing semantics.

import { createStorage } from 'unstorage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storages = new Map<string, ReturnType<typeof createStorage>>()

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ openapeIdp: { storageKey: 'idp' } }),
  useEvent: () => undefined,
  useStorage: (key: string) => {
    if (!storages.has(key)) storages.set(key, createStorage())
    return storages.get(key)!
  },
}))

async function makeStore() {
  const { createRefreshTokenStore } = await import('../src/runtime/server/utils/refresh-token-store')
  return createRefreshTokenStore()
}

describe('refresh token store', () => {
  beforeEach(async () => {
    for (const storage of storages.values()) await storage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rotates the token on consume, keeping the family', async () => {
    const store = await makeStore()
    const { token, familyId } = await store.create('user@example.com', 'sp.example.com')

    const result = await store.consume(token)
    expect(result.familyId).toBe(familyId)
    expect(result.userId).toBe('user@example.com')
    expect(result.clientId).toBe('sp.example.com')
    expect(result.newToken).not.toBe(token)

    // The rotated token keeps working
    const second = await store.consume(result.newToken)
    expect(second.familyId).toBe(familyId)
  })

  it('rejects an unknown token', async () => {
    const store = await makeStore()
    await expect(store.consume('no-such-token')).rejects.toThrow('Invalid refresh token')
  })

  it('detects reuse and revokes the whole family', async () => {
    const store = await makeStore()
    const { token } = await store.create('user@example.com', 'sp.example.com')

    const { newToken } = await store.consume(token)
    // Replay of the already-used token
    await expect(store.consume(token)).rejects.toThrow('reuse detected')
    // The legitimate successor token is dead too — family revoked
    await expect(store.consume(newToken)).rejects.toThrow('Token family revoked')
  })

  it('rejects an expired token', async () => {
    vi.useFakeTimers()
    const store = await makeStore()
    const { token } = await store.create('user@example.com', 'sp.example.com', 1000)
    vi.advanceTimersByTime(2000)
    await expect(store.consume(token)).rejects.toThrow('expired')
  })

  it('revokeByToken kills the family without consuming', async () => {
    const store = await makeStore()
    const { token } = await store.create('user@example.com', 'sp.example.com')
    await store.revokeByToken(token)
    await expect(store.consume(token)).rejects.toThrow('Token family revoked')
  })

  it('revokeFamily kills all tokens of that family', async () => {
    const store = await makeStore()
    const { token, familyId } = await store.create('user@example.com', 'sp.example.com')
    await store.revokeFamily(familyId)
    await expect(store.consume(token)).rejects.toThrow('Token family revoked')
  })

  it('revokeByUser revokes only that user\'s families', async () => {
    const store = await makeStore()
    const mine = await store.create('user@example.com', 'sp.example.com')
    const theirs = await store.create('other@example.com', 'sp.example.com')

    await store.revokeByUser('user@example.com')

    await expect(store.consume(mine.token)).rejects.toThrow('Token family revoked')
    const stillValid = await store.consume(theirs.token)
    expect(stillValid.userId).toBe('other@example.com')
  })

  it('listFamilies filters by user and hides revoked families', async () => {
    const store = await makeStore()
    const a = await store.create('user@example.com', 'sp-a.example.com')
    await store.create('user@example.com', 'sp-b.example.com')
    await store.create('other@example.com', 'sp-a.example.com')
    await store.revokeFamily(a.familyId)

    const result = await store.listFamilies('user@example.com')
    expect(result.data).toHaveLength(1)
    expect(result.data[0]!.clientId).toBe('sp-b.example.com')
    expect(result.pagination.has_more).toBe(false)
  })

  it('listFamilies paginates by cursor', async () => {
    vi.useFakeTimers()
    const store = await makeStore()
    const familyIds: string[] = []
    for (let i = 0; i < 3; i++) {
      const { familyId } = await store.create('user@example.com', `sp-${i}.example.com`)
      familyIds.push(familyId)
      vi.advanceTimersByTime(1000)
    }

    const page1 = await store.listFamilies({ userId: 'user@example.com', limit: 2 })
    expect(page1.data).toHaveLength(2)
    expect(page1.pagination.has_more).toBe(true)
    // Newest first
    expect(page1.data[0]!.familyId).toBe(familyIds[2])

    const page2 = await store.listFamilies({
      userId: 'user@example.com',
      limit: 2,
      cursor: page1.pagination.cursor!,
    })
    expect(page2.data).toHaveLength(1)
    expect(page2.data[0]!.familyId).toBe(familyIds[0])
    expect(page2.pagination.has_more).toBe(false)
  })
})
