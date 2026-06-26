import { sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'

export default defineNitroPlugin(async () => {
  try {
    const db = useDb()

    await db.run(sql`CREATE TABLE IF NOT EXISTS prs (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      author TEXT,
      author_act TEXT NOT NULL DEFAULT 'agent',
      branch TEXT,
      base_sha TEXT,
      head_sha TEXT,
      diff TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      files_count INTEGER NOT NULL DEFAULT 0,
      additions INTEGER NOT NULL DEFAULT 0,
      deletions INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_by_act TEXT NOT NULL DEFAULT 'agent',
      created_at INTEGER NOT NULL,
      deleted_at INTEGER
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_prs_creator ON prs(created_by)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_prs_created ON prs(created_at)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      pr_id TEXT NOT NULL,
      verdict TEXT NOT NULL,
      body TEXT,
      reviewed_by TEXT NOT NULL,
      reviewed_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_reviews_pr ON reviews(pr_id)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      pr_id TEXT NOT NULL,
      review_id TEXT NOT NULL,
      path TEXT NOT NULL,
      line INTEGER NOT NULL,
      side TEXT NOT NULL DEFAULT 'new',
      body TEXT NOT NULL,
      image_path TEXT,
      created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_comments_pr ON comments(pr_id)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_comments_review ON comments(review_id)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      pr_id TEXT NOT NULL,
      path TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      bytes BLOB NOT NULL,
      created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_assets_pr ON assets(pr_id)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_assets_pr_path ON assets(pr_id, path)`)
  }
  catch (err) {
    console.error('[database] Table creation failed (tables may already exist):', err)
  }
})
