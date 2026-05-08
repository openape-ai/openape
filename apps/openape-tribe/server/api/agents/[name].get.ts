import { and, desc, eq } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { agents, runs, tasks } from '../../database/schema'
import { requireOwner } from '../../utils/auth'

// Single-agent detail view: agent metadata, tasks, last 20 runs.
// `name` is the agent's `agentName` (stable, human-readable) — not
// the email — because URLs with `+` and `@` are awful. Owner-auth
// guards against cross-tenant peek (we filter by ownerEmail).
export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const name = getRouterParam(event, 'name')
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'name is required' })
  }
  const db = useDb()

  const agent = await db
    .select()
    .from(agents)
    .where(and(eq(agents.ownerEmail, owner.toLowerCase()), eq(agents.agentName, name)))
    .get()
  if (!agent) {
    throw createError({ statusCode: 404, statusMessage: 'agent not found' })
  }

  const agentTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.agentEmail, agent.email))
    .orderBy(desc(tasks.updatedAt))

  const recentRuns = await db
    .select()
    .from(runs)
    .where(eq(runs.agentEmail, agent.email))
    .orderBy(desc(runs.startedAt))
    .limit(20)

  return { agent, tasks: agentTasks, recentRuns }
})
