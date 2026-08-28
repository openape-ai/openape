import { sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'

export default defineNitroPlugin(async () => {
  const db = useDb()

  await db.run(sql`CREATE TABLE IF NOT EXISTS repos (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    default_branch TEXT NOT NULL DEFAULT 'main',
    created_at INTEGER NOT NULL
  )`)
  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_repos_owner_name ON repos(owner, name)`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_repos_owner_email ON repos(owner_email)`)

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
})
