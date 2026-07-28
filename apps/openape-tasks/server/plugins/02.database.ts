import { sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'

export default defineNitroPlugin(async () => {
  if (process.env.OPENAPE_E2E === '1') return

  try {
    const db = useDb()

    await db.run(sql`CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      archived_at INTEGER,
      org_id TEXT,
      lanes TEXT
    )`)
    // In-place add for pre-existing rows created under v0.1. Ignore if the
    // column is already there — sqlite has no IF NOT EXISTS for columns.
    for (const stmt of [
      sql`ALTER TABLE teams ADD COLUMN archived_at INTEGER`,
      sql`ALTER TABLE teams ADD COLUMN org_id TEXT`,
      sql`ALTER TABLE teams ADD COLUMN lanes TEXT`,
    ]) {
      try { await db.run(stmt) }
      catch { /* column already present */ }
    }
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_teams_org ON teams(org_id)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      role TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (team_id, user_email)
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_tm_email ON team_members(user_email)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      title TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT,
      due_at INTEGER,
      assignee_email TEXT,
      lane_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      remind_at INTEGER,
      reminder_count INTEGER NOT NULL DEFAULT 0,
      last_reminder_at INTEGER,
      reminder_max INTEGER NOT NULL DEFAULT 5,
      context_url TEXT,
      context_summary TEXT,
      owner_email TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL,
      completed_at INTEGER,
      deleted_at INTEGER
    )`)
    // In-place upgrades for pre-reminder deploys. SQLite has no IF NOT EXISTS
    // for columns so we wrap each ALTER and swallow the "duplicate column"
    // error idempotently.
    for (const stmt of [
      sql`ALTER TABLE tasks ADD COLUMN remind_at INTEGER`,
      sql`ALTER TABLE tasks ADD COLUMN reminder_count INTEGER NOT NULL DEFAULT 0`,
      sql`ALTER TABLE tasks ADD COLUMN last_reminder_at INTEGER`,
      sql`ALTER TABLE tasks ADD COLUMN reminder_max INTEGER NOT NULL DEFAULT 5`,
      sql`ALTER TABLE tasks ADD COLUMN context_url TEXT`,
      sql`ALTER TABLE tasks ADD COLUMN context_summary TEXT`,
      sql`ALTER TABLE tasks ADD COLUMN dedup_key TEXT`,
      sql`ALTER TABLE tasks ADD COLUMN lane_id TEXT`,
    ]) {
      try { await db.run(stmt) }
      catch { /* column already present */ }
    }
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_tasks_dedup ON tasks(team_id, dedup_key)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_tasks_lane ON tasks(team_id, lane_id)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_tasks_team ON tasks(team_id)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_tasks_team_status ON tasks(team_id, status)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_email)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_tasks_remind_at ON tasks(remind_at)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS team_invites (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      note TEXT,
      max_uses INTEGER NOT NULL DEFAULT 5,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_ti_team ON team_invites(team_id)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_ti_active ON team_invites(revoked_at, expires_at)`)
  }
  catch (err) {
    console.error('[database] Table creation failed (tables may already exist):', err)
  }
})
