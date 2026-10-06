import { sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { pipelineStages, workspaces } from '../database/schema'
import { defaultStageRows } from '../utils/stages'

// Greenfield: CREATE TABLE IF NOT EXISTS on boot, like the sibling apps.
// Later columns need an explicit ALTER TABLE here — otherwise the container
// starts against an old file and the endpoints throw `no such column`.
export default defineNitroPlugin(async () => {
  const db = useDb()

  await db.run(sql`CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    archived_at INTEGER
  )`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL,
    user_email TEXT NOT NULL,
    role TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, user_email)
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_wm_email ON workspace_members(user_email)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS workspace_invites (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    workspace_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    note TEXT,
    grant_role TEXT NOT NULL,
    max_uses INTEGER NOT NULL DEFAULT 5,
    used_count INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_wi_workspace ON workspace_invites(workspace_id)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    domain TEXT,
    created_at INTEGER NOT NULL
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_org_workspace ON organizations(workspace_id)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    org_id TEXT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    created_at INTEGER NOT NULL
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_contact_workspace ON contacts(workspace_id)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS pipeline_stages (
    workspace_id TEXT NOT NULL,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    outcome TEXT NOT NULL DEFAULT 'open',
    position INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, key)
  )`)

  // Workspaces aus der Zeit fester Stufen bekommen die Default-Pipeline
  // added later. Anyone with their own stages is left alone — otherwise a
  // deleted stage would come back on every boot.
  const unseeded = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(sql`NOT EXISTS (SELECT 1 FROM pipeline_stages p WHERE p.workspace_id = workspaces.id)`)
    .all()
  for (const workspace of unseeded) {
    await db.insert(pipelineStages).values(defaultStageRows(workspace.id))
  }

  await db.run(sql`CREATE TABLE IF NOT EXISTS deals (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    value_cents INTEGER NOT NULL DEFAULT 0,
    stage TEXT NOT NULL,
    contact_id TEXT,
    org_id TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    closed_at INTEGER
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_deal_workspace ON deals(workspace_id)`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_deal_stage ON deals(workspace_id, stage, position)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    deal_id TEXT NOT NULL,
    author_email TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_note_deal ON notes(deal_id, created_at)`)
})
