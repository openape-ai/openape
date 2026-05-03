import { sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'

// Auto-create tables at startup. Pattern mirrors apps/openape-free-idp:
// idempotent CREATE TABLE IF NOT EXISTS so a fresh DB just works on first
// boot and existing prod DBs aren't disturbed.
export default defineNitroPlugin(async () => {
  if (process.env.OPENAPE_E2E === '1') return

  try {
    const db = useDb()

    await db.run(sql`CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_by_email TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_rooms_created_by ON rooms(created_by_email)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS memberships (
      room_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (room_id, user_email)
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_memberships_user_email ON memberships(user_email)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      sender_email TEXT NOT NULL,
      sender_act TEXT NOT NULL,
      body TEXT NOT NULL,
      reply_to TEXT,
      created_at INTEGER NOT NULL,
      edited_at INTEGER
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(room_id, created_at)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS reactions (
      message_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (message_id, user_email, emoji)
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      email_a TEXT NOT NULL,
      email_b TEXT NOT NULL,
      status_a TEXT NOT NULL,
      status_b TEXT NOT NULL,
      room_id TEXT,
      requested_at INTEGER NOT NULL,
      accepted_at INTEGER,
      UNIQUE (email_a, email_b)
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_contacts_email_a ON contacts(email_a)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_contacts_email_b ON contacts(email_b)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_email)`)
  }
  catch (err) {
    console.error('[database] Table creation failed (tables may already exist):', err)
  }
})
