import type { Transaction } from '@libsql/client'

export async function migrateHtmlReports(tx: Transaction) {
  for (const sql of [
    'CREATE TABLE IF NOT EXISTS html_policy_state (id INTEGER PRIMARY KEY,instance_id TEXT NOT NULL,revision INTEGER NOT NULL)',
    'INSERT OR IGNORE INTO html_policy_state (id,instance_id,revision) VALUES (1,lower(hex(randomblob(16))),0)',
    `CREATE TABLE IF NOT EXISTS html_documents (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, series_id TEXT, team_id TEXT,
      audience TEXT NOT NULL DEFAULT 'private', readers TEXT NOT NULL DEFAULT '[]',
      access_revision INTEGER NOT NULL DEFAULT 1, retention_revision INTEGER NOT NULL DEFAULT 1,
      expires_at INTEGER, removed_at INTEGER, purged_at INTEGER,
      latest_version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      legacy_plan_id TEXT UNIQUE
    )`,
    `CREATE TABLE IF NOT EXISTS html_versions (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, version INTEGER NOT NULL,
      html TEXT NOT NULL, title TEXT NOT NULL, language TEXT, category TEXT,
      tags TEXT NOT NULL, metadata TEXT NOT NULL, external_images TEXT NOT NULL, external_links TEXT NOT NULL,
      source TEXT, author TEXT NOT NULL, created_at INTEGER NOT NULL,
      artifact_digest TEXT NOT NULL, policy_version TEXT NOT NULL,
      UNIQUE(document_id,version)
    )`,
    `CREATE TABLE IF NOT EXISTS html_receipts (
      identity TEXT NOT NULL, actor TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL,
      document_id TEXT NOT NULL, receipt TEXT NOT NULL, PRIMARY KEY(identity,actor,key)
    )`,
    'CREATE TABLE IF NOT EXISTS plans_migration (id INTEGER PRIMARY KEY,source_digest TEXT NOT NULL,imported_at INTEGER NOT NULL,plan_count INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS plans_imports (document_id TEXT PRIMARY KEY,source_digest TEXT NOT NULL,artifact_digest TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS idx_html_owner ON html_documents(owner)',
    'CREATE INDEX IF NOT EXISTS idx_html_team ON html_documents(team_id)',
    'CREATE INDEX IF NOT EXISTS idx_html_expiry ON html_documents(expires_at)',
    `CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, archived_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS team_members (team_id TEXT NOT NULL, user_email TEXT NOT NULL, role TEXT NOT NULL, joined_at INTEGER NOT NULL, PRIMARY KEY(team_id,user_email))`,
    `CREATE TABLE IF NOT EXISTS team_invites (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, created_by TEXT NOT NULL, note TEXT, max_uses INTEGER NOT NULL DEFAULT 5, used_count INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, revoked_at INTEGER, created_at INTEGER NOT NULL)`,
  ]) await tx.execute(sql)
}
