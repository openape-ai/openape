import { sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'

export default defineNitroPlugin(async () => {
  try {
    const db = useDb()

    await db.run(sql`CREATE TABLE IF NOT EXISTS monitors (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      interval_sec INTEGER NOT NULL DEFAULT 300,
      last_status TEXT,
      last_code INTEGER,
      last_latency_ms INTEGER,
      last_error TEXT,
      last_checked_at INTEGER,
      created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_monitors_owner ON monitors(owner_email)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_monitors_due ON monitors(last_checked_at)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS checks (
      id TEXT PRIMARY KEY,
      monitor_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      up INTEGER NOT NULL,
      status_code INTEGER,
      latency_ms INTEGER,
      error TEXT
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_checks_monitor_ts ON checks(monitor_id, ts)`)
  }
  catch (err) {
    console.error('[database] Table creation failed (tables may already exist):', err)
  }
})
