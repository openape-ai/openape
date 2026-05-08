import { desc, eq, sql } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { agents, runs, tasks } from '../../database/schema'
import { requireOwner } from '../../utils/auth'

// List the owner's agents with a few joined summary columns so the
// UI doesn't need a fan-out per row: task count + most-recent run
// status. Both subqueries are cheap on libsql for our expected data
// volume (handful of agents per owner, tasks low double-digits).
export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const db = useDb()

  const rows = await db
    .select({
      email: agents.email,
      agentName: agents.agentName,
      hostId: agents.hostId,
      hostname: agents.hostname,
      pubkeySsh: agents.pubkeySsh,
      firstSeenAt: agents.firstSeenAt,
      lastSeenAt: agents.lastSeenAt,
      createdAt: agents.createdAt,
      taskCount: sql<number>`(SELECT COUNT(*) FROM ${tasks} WHERE ${tasks.agentEmail} = ${agents.email})`,
      lastRunStatus: sql<string | null>`(SELECT status FROM ${runs} WHERE ${runs.agentEmail} = ${agents.email} ORDER BY ${runs.startedAt} DESC LIMIT 1)`,
      lastRunAt: sql<number | null>`(SELECT started_at FROM ${runs} WHERE ${runs.agentEmail} = ${agents.email} ORDER BY ${runs.startedAt} DESC LIMIT 1)`,
    })
    .from(agents)
    .where(eq(agents.ownerEmail, owner.toLowerCase()))
    .orderBy(desc(agents.createdAt))

  return rows
})
