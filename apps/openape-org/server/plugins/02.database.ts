import { sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'

// Idempotent table init — same pattern as troop, free-idp, chat, plans.
// "CREATE TABLE IF NOT EXISTS" at boot avoids a separate migration step
// in the deploy pipeline. New columns get added via ALTER TABLE blocks
// inside try/catch (SQLite has no IF NOT EXISTS for column ops).
export default defineNitroPlugin(async () => {
  if (process.env.OPENAPE_E2E === '1') return

  try {
    const db = useDb()

    await db.run(sql`CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      name TEXT NOT NULL,
      vision_md TEXT NOT NULL DEFAULT '',
      budget_monthly_eur INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_org_owner ON organizations(owner_email)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS org_members (
      org_id TEXT NOT NULL,
      agent_email TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      role TEXT NOT NULL,
      reports_to_email TEXT,
      status TEXT NOT NULL DEFAULT 'invited',
      spawned_at INTEGER,
      retired_at INTEGER,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (org_id, agent_email)
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members(org_id)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_org_members_role ON org_members(org_id, role)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS objectives (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'planned',
      target_date INTEGER,
      parent_id TEXT,
      created_by_email TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_objectives_org ON objectives(org_id)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_objectives_status ON objectives(org_id, status)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body_md TEXT NOT NULL,
      generated_by_email TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_reports_org ON reports(org_id, created_at)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS cost_snapshots (
      org_id TEXT NOT NULL,
      day TEXT NOT NULL,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      inference_cost_cents INTEGER NOT NULL DEFAULT 0,
      infra_cost_cents INTEGER NOT NULL DEFAULT 0,
      output_artifacts_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (org_id, day)
    )`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS delegation_grants (
      owner_email TEXT NOT NULL,
      audience TEXT NOT NULL,
      grant_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER,
      PRIMARY KEY (owner_email, audience)
    )`)

    // M4 schema migrations — additive columns on org_members for the
    // in-flight spawn tracking. SQLite has no IF NOT EXISTS for
    // columns, so each ALTER is wrapped in try/catch.
    for (const stmt of [
      sql`ALTER TABLE org_members ADD COLUMN spawn_intent_id TEXT`,
      sql`ALTER TABLE org_members ADD COLUMN spawn_status TEXT`,
      sql`ALTER TABLE org_members ADD COLUMN spawn_error TEXT`,
    ]) {
      try { await db.run(stmt) }
      catch { /* already exists */ }
    }
  }
  catch (err) {
    console.error('[openape-org] database init failed:', err)
  }
})
