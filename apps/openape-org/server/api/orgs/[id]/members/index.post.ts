import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { useDb } from '../../../../database/drizzle'
import { orgMembers } from '../../../../database/schema'
import { requireOwnedOrg } from '../../../../utils/orgs'

// `agent_email` is optional: the natural Owner workflow is "design the
// org-chart first (planning), spawn the actual agents in troop later".
// When omitted we mint a unique placeholder of the shape
// `pending+<short-id>@org.openape.ai` so the PK (orgId, agentEmail)
// stays unique without forcing the Owner to predict a DDISA email.
// `status` is forced to `invited` for placeholder rows — the chart
// shows them with a yellow badge so the Owner knows they aren't linked
// to a real agent yet.
const Body = z.object({
  agent_email: z.string().email().optional(),
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
  const agentEmail = parsed.data.agent_email?.trim()
    || `pending+${randomUUID().slice(0, 8)}@org.openape.ai`
  // Placeholders are always 'invited' — they can't be active because
  // no real agent exists for them yet.
  const status = parsed.data.agent_email ? parsed.data.status : 'invited'

  const db = useDb()
  await db.insert(orgMembers).values({
    orgId: org.id,
    agentEmail,
    agentName: parsed.data.agent_name,
    role: parsed.data.role,
    reportsToEmail: parsed.data.reports_to_email ?? null,
    status,
    spawnedAt: status === 'active' ? now : null,
    createdAt: now,
  })
  return { ok: true, agent_email: agentEmail, placeholder: !parsed.data.agent_email }
})
