import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { cockpitSkills } from '../../../../database/schema'
import { requireCockpitAgent } from '../../../../utils/cockpit/auth'

// On-demand fetch of a Skill's procedure. The serving agent (Operator or a delegated
// leaf under the same owner identity) loads the prompt when a task matches the
// skill's description, then follows it inline. Owner-bound, like memory fetch.
export default defineEventHandler(async (event) => {
  const agent = await requireCockpitAgent(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  const [skill] = await useDb().select().from(cockpitSkills).where(and(eq(cockpitSkills.id, id), eq(cockpitSkills.ownerEmail, agent)))
  if (!skill) throw createError({ statusCode: 404, statusMessage: 'unknown skill' })
  return { id: skill.id, name: skill.name, prompt: skill.prompt }
})
