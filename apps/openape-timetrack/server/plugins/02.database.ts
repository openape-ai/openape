import { sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'

// Greenfield: schlichtes CREATE TABLE IF NOT EXISTS beim Boot. Keine ALTER-
// Migrationen nötig (kein Pre-existing-Schema). In try/catch wegen Turso
// Cold-Start (siehe OpenApe Memory-Lesson — Plugin darf Folge-Plugins nicht
// crashen). OPENAPE_E2E=1 überspringt DB-Init für UI-only Smoke-Tests.
export default defineNitroPlugin(async () => {
  if (process.env.OPENAPE_E2E === '1') return

  try {
    const db = useDb()

    await db.run(sql`CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      archived_at INTEGER
    )`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS company_members (
      company_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      role TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (company_id, user_email)
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_cm_email ON company_members(user_email)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS company_invites (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      note TEXT,
      grant_role TEXT NOT NULL,
      max_uses INTEGER NOT NULL DEFAULT 5,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_ci_company ON company_invites(company_id)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_ci_active ON company_invites(revoked_at, expires_at)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      archived_at INTEGER
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_proj_company ON projects(company_id)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      role TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, user_email)
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_pm_email ON project_members(user_email)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS project_invites (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      note TEXT,
      grant_role TEXT NOT NULL,
      max_uses INTEGER NOT NULL DEFAULT 5,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_pi_project ON project_invites(project_id)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_pi_active ON project_invites(revoked_at, expires_at)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS time_entries (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      act TEXT NOT NULL DEFAULT 'human',
      entry_date TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      started_at INTEGER,
      ended_at INTEGER,
      description TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'code',
      billable INTEGER NOT NULL DEFAULT 1,
      is_break INTEGER NOT NULL DEFAULT 0,
      created_via TEXT NOT NULL DEFAULT 'web',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL,
      deleted_at INTEGER
    )`)
    // Idempotent in-place upgrade for tables created before is_break existed
    // (prod). SQLite has no IF NOT EXISTS for columns — swallow duplicate.
    try { await db.run(sql`ALTER TABLE time_entries ADD COLUMN is_break INTEGER NOT NULL DEFAULT 0`) }
    catch { /* column already present */ }

    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_te_company_date ON time_entries(company_id, entry_date)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_te_project_date ON time_entries(project_id, entry_date)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_te_user_date ON time_entries(user_email, entry_date)`)
  }
  catch (err) {
    console.error('[database] Table creation failed (tables may already exist):', err)
  }
})
