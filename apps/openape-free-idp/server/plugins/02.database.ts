import { sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'

export default defineNitroPlugin(async () => {
  if (process.env.OPENAPE_E2E === '1') return

  const db = useDb()

  await db.run(sql`CREATE TABLE IF NOT EXISTS grants (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    type TEXT,
    requester TEXT NOT NULL,
    target_host TEXT NOT NULL,
    audience TEXT NOT NULL,
    grant_type TEXT NOT NULL,
    request TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    decided_by TEXT,
    expires_at INTEGER,
    used_at INTEGER
  )`)

  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_grants_status ON grants(status)`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_grants_requester ON grants(requester)`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_grants_created_at ON grants(created_at)`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_grants_type ON grants(type)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS grant_challenges (
    challenge TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`)
})
