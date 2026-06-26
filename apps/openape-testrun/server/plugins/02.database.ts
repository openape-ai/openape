import { sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'

export default defineNitroPlugin(async () => {
  try {
    const db = useDb()

    await db.run(sql`CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      project TEXT,
      summary TEXT,
      status TEXT NOT NULL,
      passed_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      manifest TEXT NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      created_by TEXT NOT NULL,
      created_by_act TEXT NOT NULL DEFAULT 'human',
      created_at INTEGER NOT NULL,
      deleted_at INTEGER
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_runs_creator ON runs(created_by)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      path TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      bytes BLOB NOT NULL,
      created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_assets_run ON assets(run_id)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_assets_run_path ON assets(run_id, path)`)
  }
  catch (err) {
    console.error('[database] Table creation failed (tables may already exist):', err)
  }
})
