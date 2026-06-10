import { describe, expect, it } from 'vitest'
import { InMemoryEmailHistoryStore, InMemoryRecoveryStore } from '../idp/stores.js'
import type { RecoveryToken } from '../idp/stores.js'

const HOUR = 60 * 60 * 1000

function makeToken(overrides: Partial<RecoveryToken> = {}): RecoveryToken {
  const now = Date.now()
  return {
    token: 'recovery-token-1',
    email: 'alice@example.com',
    createdAt: now,
    usableAt: now + 72 * HOUR,
    expiresAt: now + 72 * HOUR + 14 * 24 * HOUR,
    cancelled: false,
    consumed: false,
    ...overrides,
  }
}

describe('inMemoryRecoveryStore', () => {
  it('find returns the stored token while active', async () => {
    const store = new InMemoryRecoveryStore()
    const token = makeToken()
    await store.save(token)
    const found = await store.find(token.token)
    expect(found).toEqual(token)
  })

  it('find returns null for unknown tokens', async () => {
    const store = new InMemoryRecoveryStore()
    expect(await store.find('nope')).toBeNull()
  })

  it('find returns null once consumed', async () => {
    const store = new InMemoryRecoveryStore()
    const token = makeToken()
    await store.save(token)
    await store.markConsumed(token.token)
    expect(await store.find(token.token)).toBeNull()
  })

  it('find returns null once cancelled', async () => {
    const store = new InMemoryRecoveryStore()
    const token = makeToken()
    await store.save(token)
    await store.cancelAllForEmail(token.email, 'test-cancel')
    expect(await store.find(token.token)).toBeNull()
  })

  it('find returns null after expiry', async () => {
    const store = new InMemoryRecoveryStore()
    const token = makeToken({ expiresAt: Date.now() - 1 })
    await store.save(token)
    expect(await store.find(token.token)).toBeNull()
  })

  it('listActiveForEmail excludes cancelled / consumed / expired', async () => {
    const store = new InMemoryRecoveryStore()
    await store.save(makeToken({ token: 't1' }))
    await store.save(makeToken({ token: 't2' }))
    await store.save(makeToken({ token: 't3', cancelled: true, cancelledAt: Date.now() }))
    await store.save(makeToken({ token: 't4', consumed: true }))
    await store.save(makeToken({ token: 't5', expiresAt: Date.now() - 1 }))
    await store.save(makeToken({ token: 't6', email: 'bob@example.com' }))

    const active = await store.listActiveForEmail('alice@example.com')
    expect(active.map(t => t.token).sort()).toEqual(['t1', 't2'])
  })

  it('listAllForEmail keeps the full audit history, only scoped by email', async () => {
    const store = new InMemoryRecoveryStore()
    await store.save(makeToken({ token: 't1' }))
    await store.save(makeToken({ token: 't2', cancelled: true, cancelledAt: Date.now() }))
    await store.save(makeToken({ token: 't3', consumed: true }))
    await store.save(makeToken({ token: 't4', expiresAt: Date.now() - 1 }))
    await store.save(makeToken({ token: 't5', email: 'bob@example.com' }))

    const history = await store.listAllForEmail('alice@example.com')
    expect(history.map(t => t.token).sort()).toEqual(['t1', 't2', 't3', 't4'])
  })

  it('cancelAllForEmail flips active rows and returns the count', async () => {
    const store = new InMemoryRecoveryStore()
    await store.save(makeToken({ token: 't1' }))
    await store.save(makeToken({ token: 't2' }))
    await store.save(makeToken({ token: 't3', email: 'bob@example.com' }))

    const count = await store.cancelAllForEmail('alice@example.com', 'login-veto')
    expect(count).toBe(2)
    // alice's rows are now cancelled (not findable)
    expect(await store.find('t1')).toBeNull()
    expect(await store.find('t2')).toBeNull()
    // bob's row stays active
    expect((await store.find('t3'))?.cancelled).toBe(false)
  })

  it('cancelAllForEmail skips already-cancelled and consumed rows', async () => {
    const store = new InMemoryRecoveryStore()
    await store.save(makeToken({ token: 't1', cancelled: true, cancelledAt: Date.now() }))
    await store.save(makeToken({ token: 't2', consumed: true }))
    await store.save(makeToken({ token: 't3' }))

    const count = await store.cancelAllForEmail('alice@example.com', 'test')
    expect(count).toBe(1)
  })

  it('markConsumed is a no-op for unknown tokens', async () => {
    const store = new InMemoryRecoveryStore()
    await expect(store.markConsumed('unknown')).resolves.toBeUndefined()
  })
})

describe('inMemoryEmailHistoryStore', () => {
  it('records addresses idempotently and always includes the account email', async () => {
    const store = new InMemoryEmailHistoryStore()
    await store.record('alice@example.com', 'old@example.com')
    await store.record('alice@example.com', 'old@example.com')

    const all = await store.listAllForEmail('alice@example.com')
    expect(all.sort()).toEqual(['alice@example.com', 'old@example.com'])
  })

  it('listAllForEmail returns just the email itself when nothing was recorded', async () => {
    const store = new InMemoryEmailHistoryStore()
    expect(await store.listAllForEmail('bob@example.com')).toEqual(['bob@example.com'])
  })
})
