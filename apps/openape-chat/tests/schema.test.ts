import { createClient } from '@libsql/client'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { memberships, messages, pushSubscriptions, reactions, rooms, threads } from '../server/database/schema'

// Smoke test for the chat DB schema: spin up an in-memory SQLite, run the
// same CREATE TABLE statements the production startup plugin runs, and
// exercise insert/select on each table to catch typos in the schema or the
// migration script. This file is intentionally low-level — route-handler
// behaviour gets covered by integration tests once the WS layer lands.

let db: ReturnType<typeof drizzle<{ rooms: typeof rooms, memberships: typeof memberships, messages: typeof messages, reactions: typeof reactions, pushSubscriptions: typeof pushSubscriptions, threads: typeof threads }>>

beforeEach(async () => {
  const client = createClient({ url: ':memory:' })
  db = drizzle(client, { schema: { rooms, memberships, messages, reactions, pushSubscriptions, threads } })

  await db.run(sql`CREATE TABLE rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, created_by_email TEXT NOT NULL, created_at INTEGER NOT NULL)`)
  await db.run(sql`CREATE TABLE memberships (room_id TEXT NOT NULL, user_email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', joined_at INTEGER NOT NULL, PRIMARY KEY (room_id, user_email))`)
  await db.run(sql`CREATE TABLE messages (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, thread_id TEXT, sender_email TEXT NOT NULL, sender_act TEXT NOT NULL, body TEXT NOT NULL, reply_to TEXT, created_at INTEGER NOT NULL, edited_at INTEGER)`)
  await db.run(sql`CREATE TABLE reactions (message_id TEXT NOT NULL, user_email TEXT NOT NULL, emoji TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (message_id, user_email, emoji))`)
  await db.run(sql`CREATE TABLE push_subscriptions (endpoint TEXT PRIMARY KEY, user_email TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL)`)
  await db.run(sql`CREATE TABLE threads (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, name TEXT NOT NULL, created_by_email TEXT NOT NULL, created_at INTEGER NOT NULL, archived_at INTEGER)`)
})

afterEach(() => {
  // libsql client doesn't expose close() but :memory: dies with the process anyway.
})

describe('chat schema', () => {
  it('inserts and reads a DM room', async () => {
    await db.insert(rooms).values({
      id: 'r1', name: 'patrick@hofmann.eco ↔ alice@example.com', kind: 'dm', createdByEmail: 'patrick@hofmann.eco', createdAt: 1,
    })
    const got = await db.select().from(rooms).where(eq(rooms.id, 'r1')).get()
    expect(got?.kind).toBe('dm')
  })

  it('enforces composite PK on memberships', async () => {
    await db.insert(rooms).values({ id: 'r1', name: 'r', kind: 'dm', createdByEmail: 'p@x', createdAt: 1 })
    await db.insert(memberships).values({ roomId: 'r1', userEmail: 'p@x', role: 'admin', joinedAt: 1 })
    await expect(
      db.insert(memberships).values({ roomId: 'r1', userEmail: 'p@x', role: 'member', joinedAt: 2 }),
    ).rejects.toThrow()
  })

  it('stores agent-typed messages with reactions', async () => {
    await db.insert(rooms).values({ id: 'r1', name: 'r', kind: 'dm', createdByEmail: 'p@x', createdAt: 1 })
    await db.insert(messages).values({
      id: 'm1', roomId: 'r1', senderEmail: 'agent-a@id.openape.ai', senderAct: 'agent', body: 'hello', createdAt: 10,
    })
    await db.insert(reactions).values({
      messageId: 'm1', userEmail: 'p@x', emoji: '👍', createdAt: 11,
    })

    const msg = await db.select().from(messages).where(eq(messages.id, 'm1')).get()
    expect(msg?.senderAct).toBe('agent')
    const rs = await db.select().from(reactions).where(eq(reactions.messageId, 'm1'))
    expect(rs).toHaveLength(1)
    expect(rs[0]?.emoji).toBe('👍')
  })

  it('allows multiple emojis from the same user but rejects duplicates', async () => {
    await db.insert(rooms).values({ id: 'r1', name: 'r', kind: 'dm', createdByEmail: 'p@x', createdAt: 1 })
    await db.insert(messages).values({ id: 'm1', roomId: 'r1', senderEmail: 'p@x', senderAct: 'human', body: 'x', createdAt: 1 })
    await db.insert(reactions).values({ messageId: 'm1', userEmail: 'p@x', emoji: '👍', createdAt: 1 })
    await db.insert(reactions).values({ messageId: 'm1', userEmail: 'p@x', emoji: '🔥', createdAt: 1 })
    await expect(
      db.insert(reactions).values({ messageId: 'm1', userEmail: 'p@x', emoji: '👍', createdAt: 2 }),
    ).rejects.toThrow()
  })

  it('rejects duplicate push subscription endpoints (PK enforced)', async () => {
    const sub = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      userEmail: 'p@x',
      p256dh: 'BNc...',
      auth: 'aaa',
      createdAt: 1,
    }
    await db.insert(pushSubscriptions).values(sub)
    await expect(db.insert(pushSubscriptions).values({ ...sub, userEmail: 'q@x' })).rejects.toThrow()
    const got = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint)).get()
    expect(got?.userEmail).toBe('p@x')
  })

  it('scopes messages to a thread when thread_id is set', async () => {
    await db.insert(rooms).values({ id: 'r1', name: 'r', kind: 'dm', createdByEmail: 'p@x', createdAt: 1 })
    await db.insert(threads).values({ id: 't1', roomId: 'r1', name: 'main', createdByEmail: 'p@x', createdAt: 1 })
    await db.insert(threads).values({ id: 't2', roomId: 'r1', name: 'side', createdByEmail: 'p@x', createdAt: 2 })
    await db.insert(messages).values({ id: 'm1', roomId: 'r1', threadId: 't1', senderEmail: 'p@x', senderAct: 'human', body: 'main', createdAt: 1 })
    await db.insert(messages).values({ id: 'm2', roomId: 'r1', threadId: 't2', senderEmail: 'p@x', senderAct: 'human', body: 'side', createdAt: 2 })

    const inT1 = await db.select().from(messages).where(eq(messages.threadId, 't1'))
    const inT2 = await db.select().from(messages).where(eq(messages.threadId, 't2'))
    expect(inT1.map(r => r.id)).toEqual(['m1'])
    expect(inT2.map(r => r.id)).toEqual(['m2'])
  })

  it('lists memberships joined to rooms (the GET /api/rooms shape)', async () => {
    const now = 1
    await db.insert(rooms).values({ id: 'r1', name: 'alpha', kind: 'dm', createdByEmail: 'p@x', createdAt: now })
    await db.insert(rooms).values({ id: 'r2', name: 'beta', kind: 'dm', createdByEmail: 'q@x', createdAt: now })
    await db.insert(memberships).values({ roomId: 'r1', userEmail: 'p@x', role: 'admin', joinedAt: now })
    await db.insert(memberships).values({ roomId: 'r2', userEmail: 'p@x', role: 'member', joinedAt: now })
    await db.insert(memberships).values({ roomId: 'r2', userEmail: 'q@x', role: 'admin', joinedAt: now })

    const result = await db
      .select({ id: rooms.id, name: rooms.name, role: memberships.role })
      .from(memberships)
      .innerJoin(rooms, eq(memberships.roomId, rooms.id))
      .where(eq(memberships.userEmail, 'p@x'))

    expect(result).toHaveLength(2)
    expect(result.map(r => r.id).sort()).toEqual(['r1', 'r2'])
  })
})
