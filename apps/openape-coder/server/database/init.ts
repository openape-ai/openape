// Idempotent schema bootstrap for coder.openape.ai (#585).
//
// Same pattern as openape-free-idp's 02.database.ts: CREATE TABLE IF NOT
// EXISTS for every table declared in schema.ts. Tests create in-memory DBs
// through this same function so prod and test share one schema source.

import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'

export async function ensureCoderSchema(db: LibSQLDatabase<Record<string, never>>): Promise<void> {
  await db.run(sql`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    vision_md TEXT NOT NULL DEFAULT '',
    repos TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS project_members (
    project_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    capabilities TEXT NOT NULL DEFAULT '[]',
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, email)
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_project_members_email ON project_members(email)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS invites (
    project_id TEXT NOT NULL,
    email TEXT NOT NULL,
    invited_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    accepted_at INTEGER,
    seen_at INTEGER,
    PRIMARY KEY (project_id, email)
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_invites_inviter ON invites(invited_by, created_at)`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_invites_inbox ON invites(email, accepted_at, seen_at)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    story_sentence TEXT NOT NULL,
    acceptance_criteria TEXT NOT NULL DEFAULT '',
    repos TEXT NOT NULL DEFAULT '[]',
    links TEXT NOT NULL DEFAULT '[]',
    test_references TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_stories_project ON stories(project_id)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS story_status_changes (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    status TEXT NOT NULL,
    changed_by TEXT NOT NULL,
    changed_at INTEGER NOT NULL
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_status_changes_story ON story_status_changes(story_id, changed_at)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    action TEXT NOT NULL,
    actor_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    at INTEGER NOT NULL
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log(project_id, at)`)
}
