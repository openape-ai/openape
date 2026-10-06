import { sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'

export default defineNitroPlugin(async () => {
  try {
    const db = useDb()

    await db.run(sql`CREATE TABLE IF NOT EXISTS consumers (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      name TEXT NOT NULL,
      public_key_jwk TEXT NOT NULL,
      allowed_requesters TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_consumers_owner ON consumers(owner_email)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS secret_requests (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      requester TEXT NOT NULL,
      consumer_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'requested',
      expires_at INTEGER NOT NULL,
      box_epk TEXT,
      box_salt TEXT,
      box_iv TEXT,
      box_ct TEXT,
      created_at INTEGER NOT NULL,
      filled_at INTEGER,
      fetched_at INTEGER
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_requests_owner ON secret_requests(owner_email)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_requests_consumer ON secret_requests(consumer_id)`)
  }
  catch (err) {
    console.error('[database] Table creation failed (tables may already exist):', err)
  }
})
