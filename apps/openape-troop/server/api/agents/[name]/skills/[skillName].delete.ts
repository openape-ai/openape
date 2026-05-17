import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { agents, agentSkills } from '../../../../database/schema'
import { requireOwner } from '../../../../utils/auth'
import { broadcastToOwner } from '../../../../utils/nest-registry'

// Delete a skill (hard delete — to "soft disable" use PUT with
// `enabled: false`). After the next sync the agent host's
// `~/.openape/agent/skills/<name>/SKILL.md` will be removed too,
// because the sync command does a one-way mirror from troop.
export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const name = getRouterParam(event, 'name')
  const skillName = getRouterParam(event, 'skillName')
  if (!name || !skillName) {
    throw createError({ statusCode: 400, statusMessage: 'name and skillName are required' })
  }

  const db = useDb()
  const agent = await db
    .select({ email: agents.email })
    .from(agents)
    .where(and(eq(agents.ownerEmail, owner.toLowerCase()), eq(agents.agentName, name)))
    .get()
  if (!agent) throw createError({ statusCode: 404, statusMessage: 'agent not found' })

  const deleted = await db
    .delete(agentSkills)
    .where(and(eq(agentSkills.agentEmail, agent.email), eq(agentSkills.name, skillName)))
    .returning({ name: agentSkills.name })

  if (deleted.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'skill not found' })
  }
  broadcastToOwner(owner.toLowerCase(), {
    type: 'config-update',
    agent_email: agent.email,
  })

  return { ok: true, name: deleted[0]!.name }
})
