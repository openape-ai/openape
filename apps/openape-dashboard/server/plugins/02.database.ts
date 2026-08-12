import { sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'

// Greenfield: CREATE TABLE IF NOT EXISTS on boot. try/catch so a cold DB
// doesn't crash follow-up plugins. OPENAPE_E2E=1 skips DB init for UI-only
// smoke tests.
export default defineNitroPlugin(async () => {
  if (process.env.OPENAPE_E2E === '1')
    return

  try {
    const db = useDb()
    await db.run(sql`CREATE TABLE IF NOT EXISTS kpis (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      scope TEXT NOT NULL,
      key TEXT NOT NULL,
      value REAL NOT NULL,
      unit TEXT,
      detail TEXT,
      source TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_kpis_owner_created ON kpis(owner, created_at)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_kpis_owner_scope_key ON kpis(owner, scope, key)`)
  }
  catch (err) {
    console.error('[database] kpis creation failed:', err)
  }
})
