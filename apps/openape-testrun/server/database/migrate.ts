import type { Client, Transaction } from '@libsql/client'

async function addColumn(tx: Transaction, table: string, name: string, definition: string) {
  const columns = await tx.execute(`PRAGMA table_info(${table})`)
  if (!columns.rows.some(row => row.name === name)) await tx.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
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
    for (const statement of [
      'CREATE INDEX IF NOT EXISTS idx_runs_creator ON runs(created_by)',
      'CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_runs_series ON runs(created_by, series)',
      'CREATE INDEX IF NOT EXISTS idx_assets_run ON assets(run_id)',
      'CREATE INDEX IF NOT EXISTS idx_assets_run_path ON assets(run_id, path)',
      'CREATE INDEX IF NOT EXISTS idx_run_versions_run ON run_versions(run_id, version)',
    ]) await tx.execute(statement)
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
