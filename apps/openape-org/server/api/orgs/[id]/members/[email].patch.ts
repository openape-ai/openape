import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../../database/drizzle'
import { orgMembers } from '../../../../database/schema'
import { requireOwnedOrg } from '../../../../utils/orgs'

// Update a member row. Two important cases:
//   1. **Replacing a placeholder email**: the row was created with
//      `pending+<id>@org.openape.ai` because no real agent existed
//      yet; once the Owner has spawned the agent in troop, they
//      come back and paste the real DDISA email. Because
//      `agent_email` is part of the PK we delete the placeholder
//      and re-insert under the new key (SQLite has no `UPDATE PK`).
//   2. **Standard edits** (name, role, status, reports_to) — straight UPDATE.
const Body = z.object({
  agent_email: z.string().email().optional(),
  agent_name: z.string().min(1).max(64).optional(),
  role: z.enum(['ceo', 'teamlead', 'specialist', 'sanierer', 'other']).optional(),
  reports_to_email: z.string().email().nullable().optional(),
  status: z.enum(['invited', 'active', 'retired']).optional(),
})

export default defineEventHandler(async (event) => {
  const { org } = await requireOwnedOrg(event)
  const oldEmail = getRouterParam(event, 'email')
  if (!oldEmail) throw createError({ statusCode: 400, statusMessage: 'member email required' })

  const body = await readBody(event)
  const parsed = Body.safeParse(body)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'invalid body', data: parsed.error.flatten() })

  const db = useDb()
  const existing = await db.select().from(orgMembers).where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.agentEmail, oldEmail))).limit(1)
  const row = existing[0]
  if (!row) throw createError({ statusCode: 404, statusMessage: 'member not found' })

  const now = Math.floor(Date.now() / 1000)
  const newEmail = parsed.data.agent_email && parsed.data.agent_email !== oldEmail
    ? parsed.data.agent_email
    : null

  if (newEmail) {
    // PK change → delete + insert
    await db.delete(orgMembers).where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.agentEmail, oldEmail)))
    await db.insert(orgMembers).values({
      orgId: row.orgId,
      agentEmail: newEmail,
      agentName: parsed.data.agent_name ?? row.agentName,
      role: parsed.data.role ?? row.role,
      reportsToEmail: parsed.data.reports_to_email !== undefined ? parsed.data.reports_to_email : row.reportsToEmail,
      // Once a real email is bound, default the status to 'active'
      // unless the caller said otherwise — the placeholder lived as
      // 'invited' and the swap-in implies the agent now exists.
      status: parsed.data.status ?? 'active',
      spawnedAt: (parsed.data.status ?? 'active') === 'active' ? (row.spawnedAt ?? now) : row.spawnedAt,
      retiredAt: row.retiredAt,
      createdAt: row.createdAt,
    })
    return { ok: true, agent_email: newEmail, replaced: true }
  }

  const updates: Record<string, unknown> = {}
  if (parsed.data.agent_name !== undefined) updates.agentName = parsed.data.agent_name
  if (parsed.data.role !== undefined) updates.role = parsed.data.role
  if (parsed.data.reports_to_email !== undefined) updates.reportsToEmail = parsed.data.reports_to_email
  if (parsed.data.status !== undefined) {
    updates.status = parsed.data.status
    if (parsed.data.status === 'active' && !row.spawnedAt) updates.spawnedAt = now
    if (parsed.data.status === 'retired' && !row.retiredAt) updates.retiredAt = now
  }
  if (Object.keys(updates).length > 0) {
    await db.update(orgMembers).set(updates).where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.agentEmail, oldEmail)))
  }
  return { ok: true, agent_email: oldEmail }
})
