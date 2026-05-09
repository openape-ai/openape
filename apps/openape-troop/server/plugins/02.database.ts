import { sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'

// Idempotent table init. Drizzle Studio + drizzle-kit are nice but our
// pattern across the openape monorepo is "CREATE TABLE IF NOT EXISTS"
// at boot — same as openape-free-idp + openape-chat — so the deploy
// pipeline doesn't need a separate migration step. New columns get
// added via ALTER TABLE in this file later if/when needed.
export default defineNitroPlugin(async () => {
  if (process.env.OPENAPE_E2E === '1') return

  try {
    const db = useDb()

    await db.run(sql`CREATE TABLE IF NOT EXISTS agents (
      email TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      host_id TEXT,
      hostname TEXT,
      pubkey_ssh TEXT,
      system_prompt TEXT NOT NULL DEFAULT '',
      first_seen_at INTEGER,
      last_seen_at INTEGER,
      created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner_email)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_agents_host ON agents(host_id)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS tasks (
      agent_email TEXT NOT NULL,
      task_id TEXT NOT NULL,
      name TEXT NOT NULL,
      cron TEXT NOT NULL,
      user_prompt TEXT NOT NULL DEFAULT '',
      tools TEXT NOT NULL,
      max_steps INTEGER NOT NULL DEFAULT 10,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (agent_email, task_id)
    )`)

    // Idempotent migration block — runs every boot but each ALTER is
    // wrapped in try/catch since SQLite has no IF NOT EXISTS for column
    // ops. The point: agents created before the system-prompt refactor
    // (#346) stay readable, and existing pre-refactor task rows keep
    // their content (the per-task system_prompt becomes user_prompt).
    try {
      await db.run(sql`ALTER TABLE agents ADD COLUMN system_prompt TEXT NOT NULL DEFAULT ''`)
    }
    catch { /* column exists */ }
    try {
      await db.run(sql`ALTER TABLE tasks RENAME COLUMN system_prompt TO user_prompt`)
    }
    catch { /* already renamed, or table created fresh with user_prompt */ }
    try {
      await db.run(sql`ALTER TABLE tasks ADD COLUMN user_prompt TEXT NOT NULL DEFAULT ''`)
    }
    catch { /* column exists (either via fresh create or from rename above) */ }

    await db.run(sql`CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      agent_email TEXT NOT NULL,
      task_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      status TEXT NOT NULL,
      final_message TEXT,
      step_count INTEGER,
      trace TEXT
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_runs_agent_task ON runs(agent_email, task_id)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at)`)
  }
  catch (err) {
    console.error('[troop/database] table init failed:', err)
  }
})
