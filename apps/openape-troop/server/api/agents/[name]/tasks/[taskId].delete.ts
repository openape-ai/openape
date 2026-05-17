import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { agents, tasks } from '../../../../database/schema'
import { requireOwner } from '../../../../utils/auth'

export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const name = getRouterParam(event, 'name')
  const taskId = getRouterParam(event, 'taskId')
  if (!name || !taskId) {
    throw createError({ statusCode: 400, statusMessage: 'name and taskId required' })
  }

  const db = useDb()
  const agent = await db
    .select({ email: agents.email })
    .from(agents)
    .where(and(eq(agents.ownerEmail, owner.toLowerCase()), eq(agents.agentName, name)))
    .get()
  if (!agent) throw createError({ statusCode: 404, statusMessage: 'agent not found' })

  await db
    .delete(tasks)
    .where(and(eq(tasks.agentEmail, agent.email), eq(tasks.taskId, taskId)))

  setResponseStatus(event, 204)
})
