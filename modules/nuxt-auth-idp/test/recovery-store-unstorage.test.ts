// story: recovery-audit
//
// Parity pin for issue #583 — criterion 6: audit-history entries never
// change after the fact. All RecoveryStore implementations must skip
// already expired, unconsumed tokens in `cancelAllForEmail` (their outcome
// stays "expired", never "cancelled") and return the count of rows actually
// changed. The Drizzle store in openape-free-idp had drifted here; this
// pins the Unstorage implementation.

import type { RecoveryToken } from '@openape/auth'
import { createStorage } from 'unstorage'
import { describe, expect, it, vi } from 'vitest'

const storage = createStorage()

vi.mock('../src/runtime/server/utils/storage', () => ({
  useIdpStorage: () => storage,
}))

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const EMAIL = 'owner@example.com'

function makeToken(token: string, overrides: Partial<RecoveryToken> = {}): RecoveryToken {
  const now = Date.now()
  return {
    token,
    email: EMAIL,
    createdAt: now - 2 * DAY,
    usableAt: now + 5 * DAY,
    expiresAt: now + 19 * DAY,
    cancelled: false,
    consumed: false,
    ...overrides,
  }
}

describe('unstorage recovery store — cancelAllForEmail parity (issue #583)', () => {
  // story: recovery-audit — criterion 6
  it('skips expired, unconsumed tokens and returns the count of rows actually changed', async () => {
    const { createRecoveryStore } = await import('../src/runtime/server/utils/recovery-store')
    const store = createRecoveryStore()
    await store.save(makeToken('tok-active'))
    await store.save(makeToken('tok-expired', {
      usableAt: Date.now() - 20 * DAY,
      expiresAt: Date.now() - 6 * DAY,
    }))

    const count = await store.cancelAllForEmail(EMAIL, 'cancelled-by-owner')
    expect(count).toBe(1)

    const history = await store.listAllForEmail(EMAIL)
    const expired = history.find(entry => entry.token === 'tok-expired')
    expect(expired?.cancelled, 'expired attempt must NOT flip to cancelled').toBe(false)
    expect(expired?.cancelledAt).toBeUndefined()

    const active = history.find(entry => entry.token === 'tok-active')
    expect(active?.cancelled).toBe(true)
    expect(active?.cancelledReason).toBe('cancelled-by-owner')
  })
})
