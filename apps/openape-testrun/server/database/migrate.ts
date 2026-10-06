import type { Client, Transaction } from '@libsql/client'
import { migrateHtmlReports } from './html-migration'

async function addColumn(tx: Transaction, table: string, name: string, definition: string) {
  const columns = await tx.execute(`PRAGMA table_info(${table})`)
  if (!columns.rows.some(row => row.name === name)) await tx.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
}

async function allowBriefingStatus(tx: Transaction, table: 'runs' | 'run_versions') {
  const columns = await tx.execute(`PRAGMA table_info(${table})`)
  if (!columns.rows.find(row => row.name === 'status')?.notnull) return
  const schema = await tx.execute({ sql: 'SELECT sql FROM sqlite_master WHERE type = \'table\' AND name = ?', args: [table] })
  const original = String(schema.rows[0]!.sql)
  const definition = original.replace(/status TEXT NOT NULL/i, 'status TEXT')
  if (original === definition) throw new Error(`Unrecognized ${table} status definition`)
  const indexes = await tx.execute({ sql: 'SELECT sql FROM sqlite_master WHERE tbl_name = ? AND type IN (\'index\', \'trigger\') AND sql IS NOT NULL', args: [table] })
  await tx.execute(definition.replace(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?\w+["`]?/i, `CREATE TABLE ${table}_reports_migration`))
  await tx.execute(`INSERT INTO ${table}_reports_migration SELECT * FROM ${table}`)
  await tx.execute(`DROP TABLE ${table}`)
  await tx.execute(`ALTER TABLE ${table}_reports_migration RENAME TO ${table}`)
  for (const row of indexes.rows) await tx.execute(String(row.sql))
}

export async function migrateReports(client: Client) {
  const tx = await client.transaction('write')
  try {
    await tx.execute(`CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
      project TEXT, summary TEXT, status TEXT NOT NULL,
      passed_count INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0, manifest TEXT NOT NULL,
      started_at INTEGER, finished_at INTEGER, created_by TEXT NOT NULL,
      created_by_act TEXT NOT NULL DEFAULT 'human', created_at INTEGER NOT NULL, deleted_at INTEGER
    )`)
    await tx.execute(`CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, path TEXT NOT NULL,
      content_type TEXT NOT NULL, size INTEGER NOT NULL, bytes BLOB NOT NULL, created_at INTEGER NOT NULL
    )`)
    await addColumn(tx, 'runs', 'series', 'TEXT')
    await addColumn(tx, 'runs', 'version', 'INTEGER NOT NULL DEFAULT 1')
    await addColumn(tx, 'assets', 'version', 'INTEGER NOT NULL DEFAULT 1')
    await tx.execute(`CREATE TABLE IF NOT EXISTS run_versions (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, version INTEGER NOT NULL,
      title TEXT NOT NULL, project TEXT, summary TEXT, status TEXT NOT NULL,
      passed_count INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0, manifest TEXT NOT NULL,
      started_at INTEGER, finished_at INTEGER, created_at INTEGER NOT NULL
    )`)
    await addColumn(tx, 'runs', 'report_type', 'TEXT NOT NULL DEFAULT \'test\'')
    await addColumn(tx, 'runs', 'visibility', 'TEXT NOT NULL DEFAULT \'shared\'')
    await addColumn(tx, 'run_versions', 'report_type', 'TEXT NOT NULL DEFAULT \'test\'')
    await allowBriefingStatus(tx, 'runs')
    await allowBriefingStatus(tx, 'run_versions')
    await tx.execute(`CREATE TABLE IF NOT EXISTS report_series (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      publisher TEXT, revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL,
      UNIQUE(owner, name)
    )`)
    await tx.execute(`CREATE TABLE IF NOT EXISTS report_publications (
      id TEXT PRIMARY KEY, series_id TEXT NOT NULL, edition_date TEXT NOT NULL,
      version INTEGER NOT NULL, digest TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      publisher TEXT NOT NULL, created_at INTEGER NOT NULL,
      UNIQUE(series_id, edition_date), UNIQUE(series_id, idempotency_key), UNIQUE(series_id, version)
    )`)
    await tx.execute(`CREATE TABLE IF NOT EXISTS document_publications (
      id TEXT PRIMARY KEY, series_id TEXT, version INTEGER NOT NULL,
      owner TEXT NOT NULL, publisher TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      digest TEXT NOT NULL, artifact_digest TEXT NOT NULL, policy_version TEXT NOT NULL,
      category TEXT, category_key TEXT, language TEXT, artifact TEXT NOT NULL,
      created_at INTEGER NOT NULL, UNIQUE(owner, idempotency_key), UNIQUE(series_id, version)
    )`)
    for (const statement of [
      'CREATE INDEX IF NOT EXISTS idx_runs_creator ON runs(created_by)',
      'CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_runs_series ON runs(created_by, series)',
      'CREATE INDEX IF NOT EXISTS idx_assets_run ON assets(run_id)',
      'CREATE INDEX IF NOT EXISTS idx_assets_run_path ON assets(run_id, path)',
      'CREATE INDEX IF NOT EXISTS idx_run_versions_run ON run_versions(run_id, version)',
    ]) await tx.execute(statement)
    await migrateHtmlReports(tx)
    await tx.commit()
  }
  catch (error) {
    await tx.rollback()
    throw error
  }
  finally {
    tx.close()
  }
}
