import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { agents, agentSkills } from '../../../../database/schema'
import { requireOwner } from '../../../../utils/auth'

// List the agent's skills (owner-side view — includes disabled rows
// so the toggle has a thing to flip). The agent's own /me/tasks
// endpoint filters disabled rows out before sending to the runtime.
export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const name = getRouterParam(event, 'name')
  if (!name) throw createError({ statusCode: 400, statusMessage: 'name is required' })

  const db = useDb()
  const agent = await db
    .select({ email: agents.email })
    .from(agents)
    .where(and(eq(agents.ownerEmail, owner.toLowerCase()), eq(agents.agentName, name)))
    .get()
  if (!agent) throw createError({ statusCode: 404, statusMessage: 'agent not found' })

  const rows = await db
    .select()
    .from(agentSkills)
    .where(eq(agentSkills.agentEmail, agent.email))
  return rows
})
