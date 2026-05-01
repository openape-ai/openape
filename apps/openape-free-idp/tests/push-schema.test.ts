import { createClient } from '@libsql/client'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pushSubscriptions } from '../server/database/schema'

// Spin up an in-memory SQLite, run the same CREATE TABLE the production
// startup plugin runs, and exercise insert/select on the new
// push_subscriptions table to catch typos in either definition.

let db: ReturnType<typeof drizzle<{ pushSubscriptions: typeof pushSubscriptions }>>

beforeEach(async () => {
  const client = createClient({ url: ':memory:' })
  db = drizzle(client, { schema: { pushSubscriptions } })

  await db.run(sql`CREATE TABLE push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    user_email TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`)
})

afterEach(() => {
  // libsql :memory: dies with the test process.
})

describe('push_subscriptions schema', () => {
  it('inserts and reads a subscription row', async () => {
    await db.insert(pushSubscriptions).values({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      userEmail: 'patrick@hofmann.eco',
      p256dh: 'BN…',
      auth: 'aa…',
      createdAt: 1,
    })
    const got = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, 'https://fcm.googleapis.com/fcm/send/abc123'))
      .get()
    expect(got).toMatchObject({ userEmail: 'patrick@hofmann.eco', p256dh: 'BN…' })
  })

  it('rejects duplicate endpoints (PK enforced)', async () => {
    const sub = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      userEmail: 'patrick@hofmann.eco',
      p256dh: 'BN…',
      auth: 'aa…',
      createdAt: 1,
    }
    await db.insert(pushSubscriptions).values(sub)
    await expect(db.insert(pushSubscriptions).values({ ...sub, userEmail: 'other@x' })).rejects.toThrow()
  })

  it('lets the same user have multiple subscriptions (different endpoints)', async () => {
    await db.insert(pushSubscriptions).values({
      endpoint: 'https://fcm.googleapis.com/fcm/send/aaa',
      userEmail: 'patrick@hofmann.eco',
      p256dh: 'BN1', auth: 'a1', createdAt: 1,
    })
    await db.insert(pushSubscriptions).values({
      endpoint: 'https://updates.push.services.mozilla.com/wpush/v1/zzz',
      userEmail: 'patrick@hofmann.eco',
      p256dh: 'BN2', auth: 'a2', createdAt: 2,
    })
    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userEmail, 'patrick@hofmann.eco'))
    expect(rows).toHaveLength(2)
  })
})
