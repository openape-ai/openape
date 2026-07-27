import { sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'

// Greenfield: CREATE TABLE IF NOT EXISTS on boot. The queue table is defined by
// @openape/sp-tasks; we just materialize it here. try/catch so a cold DB doesn't
// crash follow-up plugins. OPENAPE_E2E=1 skips DB init for UI-only smoke tests.
export default defineNitroPlugin(async () => {
  if (process.env.OPENAPE_E2E === '1')
    return

  try {
    const db = useDb()
    await db.run(sql`CREATE TABLE IF NOT EXISTS agent_tasks (
      id TEXT PRIMARY KEY,
      context_id TEXT NOT NULL,
      type TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'submitted',
      history TEXT NOT NULL DEFAULT '[]',
      artifacts TEXT NOT NULL DEFAULT '[]',
      assignee TEXT,
      lease_until INTEGER,
      delivery_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_agent_tasks_state ON agent_tasks(state)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_agent_tasks_lease ON agent_tasks(lease_until)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_agent_tasks_context ON agent_tasks(context_id)`)
  }
  catch (err) {
    console.error('[database] agent_tasks creation failed:', err)
  }
})
