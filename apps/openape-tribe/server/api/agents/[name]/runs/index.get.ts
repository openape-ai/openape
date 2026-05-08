import { and, desc, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { agents, runs } from '../../../../database/schema'
import { requireOwner } from '../../../../utils/auth'

// Paginated run history for a single agent. Default page size 50,
// max 200. Optional `?task_id=` filter narrows to one task.
export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const name = getRouterParam(event, 'name')
  if (!name) throw createError({ statusCode: 400, statusMessage: 'name required' })

  const query = getQuery(event)
  const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 200)
  const taskFilter = typeof query.task_id === 'string' ? query.task_id : null

  const db = useDb()
  const agent = await db
    .select({ email: agents.email })
    .from(agents)
    .where(and(eq(agents.ownerEmail, owner.toLowerCase()), eq(agents.agentName, name)))
    .get()
  if (!agent) throw createError({ statusCode: 404, statusMessage: 'agent not found' })

  const rows = await db
    .select()
    .from(runs)
    .where(taskFilter
      ? and(eq(runs.agentEmail, agent.email), eq(runs.taskId, taskFilter))
      : eq(runs.agentEmail, agent.email))
    .orderBy(desc(runs.startedAt))
    .limit(limit)

  return rows
})
