// story: recovery-audit
//
// Criterion 1: every recovery event (request, cancel, completion, expiry) is
// recorded durably and survives a server restart — recovery_tokens rows are
// the record, and the store must be able to list ALL of them, not just the
// active ones (`listActiveForEmail` filters history away).
//
// Green-phase surface: `listAllForEmail(email)` on the RecoveryStore
// (see stories/recovery-audit.md, Abhängigkeiten).

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

describe('recovery audit history — durable store (issue #462)', () => {
  // story: recovery-audit — criterion 1
  it('lists the full history — running, cancelled, completed and expired attempts', async () => {
    const store = await makeStore()
    await store.save(makeToken('tok-running') as any)
    await store.save(makeToken('tok-cancelled', { cancelled: true, cancelledAt: Date.now() - DAY, cancelledReason: 'cancelled-by-owner' }) as any)
    await store.save(makeToken('tok-completed', { consumed: true }) as any)
    await store.save(makeToken('tok-expired', { usableAt: Date.now() - 20 * DAY, expiresAt: Date.now() - 6 * DAY }) as any)

    const listAllForEmail = (store as Record<string, unknown>).listAllForEmail
    expect(typeof listAllForEmail, 'RecoveryStore must expose listAllForEmail — the audit-history query').toBe('function')

    const history = await (listAllForEmail as (email: string) => Promise<Record<string, unknown>[]>).call(store, EMAIL)
    expect(history.map(entry => entry.token).sort()).toEqual(['tok-cancelled', 'tok-completed', 'tok-expired', 'tok-running'])
    for (const entry of history) {
      expect(entry.requestIp).toBe('203.0.113.7')
      expect(entry.requestUserAgent).toBe('TestBrowser/1.0')
      expect(entry.createdAt).toBeTypeOf('number')
    }
  })

  // story: recovery-audit — criterion 1
  it('history survives a restart — a fresh store over the same database sees everything', async () => {
    const store = await makeStore()
    await store.save(makeToken('tok-1') as any)
    await store.cancelAllForEmail(EMAIL, 'cancelled-by-owner')

    // "Restart": a brand-new store instance over the same database. The
    // cancelled attempt must still be on record — console logs would be gone.
    const restartedStore = await makeStore()
    const listAllForEmail = (restartedStore as Record<string, unknown>).listAllForEmail
    expect(typeof listAllForEmail, 'RecoveryStore must expose listAllForEmail — the audit-history query').toBe('function')

    const history = await (listAllForEmail as (email: string) => Promise<Record<string, unknown>[]>).call(restartedStore, EMAIL)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ token: 'tok-1', cancelled: true, cancelledReason: 'cancelled-by-owner' })
  })
})
