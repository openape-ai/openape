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
      created_at INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'http',
      ping_token TEXT,
      last_ping_at INTEGER
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

    // Columns added after the first release. SQLite has no ADD COLUMN IF NOT
    // EXISTS, and the CREATE above only fires on an empty database, so an
    // existing deployment gets them here. Runs LAST on purpose: an ALTER that
    // surprises us must not stop the table creation above from finishing.
    //
    // libsql puts "duplicate column name" on the error's `cause` and leaves
    // `message` as the bare failed query — matching only the message rethrows
    // on a fresh database, where all three columns already exist from the
    // CREATE. Match the whole chain.
    for (const ddl of [
      `ALTER TABLE monitors ADD COLUMN kind TEXT NOT NULL DEFAULT 'http'`,
      `ALTER TABLE monitors ADD COLUMN ping_token TEXT`,
      `ALTER TABLE monitors ADD COLUMN last_ping_at INTEGER`,
    ]) {
      try {
        await db.run(sql.raw(ddl))
      }
      catch (err) {
        const chain = `${(err as Error).message} ${String((err as { cause?: unknown }).cause ?? '')}`
        if (!/duplicate column/i.test(chain)) throw err
      }
    }
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_monitors_ping_token ON monitors(ping_token)`)
  }
  catch (err) {
    console.error('[database] Table creation failed (tables may already exist):', err)
  }
})
