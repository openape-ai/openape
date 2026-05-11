import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../../database/drizzle'
import { agents, agentSkills } from '../../../../database/schema'
import { requireOwner } from '../../../../utils/auth'

// Upsert a skill — name is the natural key (per agent). Body is the
// full SKILL.md content the agent will land on disk after sync, so
// the owner can paste in markdown directly. We validate that name
// matches our slug convention so the path is safe to use as a dir
// name on the agent host (it becomes `skills/<name>/SKILL.md`).
const SKILL_NAME_REGEX = /^[a-z][a-z0-9-]{0,31}$/

const bodySchema = z.object({
  name: z.string().regex(SKILL_NAME_REGEX, 'name must match /^[a-z][a-z0-9-]{0,31}$/'),
  description: z.string().min(1).max(500),
  body: z.string().min(1).max(64_000),
  enabled: z.boolean().optional().default(true),
})

export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const name = getRouterParam(event, 'name')
  if (!name) throw createError({ statusCode: 400, statusMessage: 'name is required' })

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'invalid body' })
  }

  const db = useDb()
  const agent = await db
    .select({ email: agents.email })
    .from(agents)
    .where(and(eq(agents.ownerEmail, owner.toLowerCase()), eq(agents.agentName, name)))
    .get()
  if (!agent) throw createError({ statusCode: 404, statusMessage: 'agent not found' })

  const now = Math.floor(Date.now() / 1000)
  const existing = await db
    .select({ name: agentSkills.name })
    .from(agentSkills)
    .where(and(eq(agentSkills.agentEmail, agent.email), eq(agentSkills.name, parsed.data.name)))
    .get()

  if (existing) {
    await db
      .update(agentSkills)
      .set({
        description: parsed.data.description,
        body: parsed.data.body,
        enabled: parsed.data.enabled,
        updatedAt: now,
      })
      .where(and(eq(agentSkills.agentEmail, agent.email), eq(agentSkills.name, parsed.data.name)))
  }
  else {
    await db.insert(agentSkills).values({
      agentEmail: agent.email,
      name: parsed.data.name,
      description: parsed.data.description,
      body: parsed.data.body,
      enabled: parsed.data.enabled,
      createdAt: now,
      updatedAt: now,
    })
  }
  return { ok: true, name: parsed.data.name }
})
