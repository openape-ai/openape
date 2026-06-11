// story: recovery-audit
//
// Regression for issue #583 — criterion 6: history entries must never change
// after the fact. `cancelAllForEmail` counted only active (non-expired)
// tokens but UPDATEd every non-cancelled/non-consumed row, so an already
// expired attempt ("expired" in the audit history) was flipped to
// "cancelled" later — and the returned count no longer matched the rows
// actually changed. The InMemory and Unstorage stores skip expired tokens;
// the Drizzle store must behave identically (cross-implementation parity).

import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../server/database/schema'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const EMAIL = 'owner@example.com'

const { dbRef } = vi.hoisted(() => ({ dbRef: { db: undefined as unknown } }))

vi.mock('../server/database/drizzle', () => ({
  useDb: () => dbRef.db,
}))

function makeToken(token: string, overrides: Record<string, unknown> = {}) {
  const now = Date.now()
  return {
    token,
    email: EMAIL,
    createdAt: now - 2 * DAY,
    usableAt: now + 5 * DAY,
    expiresAt: now + 19 * DAY,
    cancelled: false,
    consumed: false,
    requestIp: '203.0.113.7',
    requestUserAgent: 'TestBrowser/1.0',
    ...overrides,
  }
}

beforeEach(async () => {
  const db = drizzle(createClient({ url: ':memory:' }), { schema })
  await db.run(sql`CREATE TABLE recovery_tokens (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    usable_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    cancelled INTEGER NOT NULL DEFAULT 0,
    cancelled_at INTEGER,
    cancelled_reason TEXT,
    consumed INTEGER NOT NULL DEFAULT 0,
    request_ip TEXT,
    request_user_agent TEXT
  )`)
  dbRef.db = db
})

async function makeStore() {
  const { createDrizzleRecoveryStore } = await import('../server/utils/drizzle-recovery-store')
  return createDrizzleRecoveryStore()
}

describe('cancelAllForEmail leaves expired history untouched (issue #583)', () => {
  // story: recovery-audit — criterion 6
  it('an expired, unconsumed token keeps its "expired" outcome and the count matches the changed rows', async () => {
    const store = await makeStore()
    await store.save(makeToken('tok-active') as any)
    await store.save(makeToken('tok-expired', {
      usableAt: Date.now() - 20 * DAY,
      expiresAt: Date.now() - 6 * DAY,
    }) as any)

    const count = await store.cancelAllForEmail(EMAIL, 'cancelled-by-owner')
    expect(count, 'count must equal the rows actually changed').toBe(1)

    const history = await store.listAllForEmail(EMAIL)
    const expired = history.find(entry => entry.token === 'tok-expired')
    expect(expired?.cancelled, 'expired attempt must NOT flip to cancelled').toBe(false)
    expect(expired?.cancelledAt).toBeUndefined()
    expect(expired?.cancelledReason).toBeUndefined()

    const active = history.find(entry => entry.token === 'tok-active')
    expect(active?.cancelled).toBe(true)
    expect(active?.cancelledReason).toBe('cancelled-by-owner')
  })
})
