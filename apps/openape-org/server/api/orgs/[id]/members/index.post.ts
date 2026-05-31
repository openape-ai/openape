import { z } from 'zod'
import { useDb } from '../../../../database/drizzle'
import { orgMembers } from '../../../../database/schema'
import { requireOwnedOrg } from '../../../../utils/orgs'

const Body = z.object({
  agent_email: z.string().email(),
  agent_name: z.string().min(1).max(64),
  role: z.enum(['ceo', 'teamlead', 'specialist', 'sanierer', 'other']),
  reports_to_email: z.string().email().nullable().optional(),
  status: z.enum(['invited', 'active', 'retired']).optional().default('invited'),
})

export default defineEventHandler(async (event) => {
  const { org } = await requireOwnedOrg(event)
  const body = await readBody(event)
  const parsed = Body.safeParse(body)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'invalid body', data: parsed.error.flatten() })

  const now = Math.floor(Date.now() / 1000)
  const db = useDb()
  await db.insert(orgMembers).values({
    orgId: org.id,
    agentEmail: parsed.data.agent_email,
    agentName: parsed.data.agent_name,
    role: parsed.data.role,
    reportsToEmail: parsed.data.reports_to_email ?? null,
    status: parsed.data.status,
    spawnedAt: parsed.data.status === 'active' ? now : null,
    createdAt: now,
  })
  return { ok: true }
})
