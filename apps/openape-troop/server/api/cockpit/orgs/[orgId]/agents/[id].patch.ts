import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../../database/drizzle'
import { cockpitAgents } from '../../../../../database/schema'
import { requireOwnedOrg } from '../../../../../utils/cockpit/org-access'
import { assertVars } from '../../../../../utils/cockpit/vars'

// Edit a delegation leaf. Any subset of role/label/duties/procedure/vars/tools/
// reportsTo/enabled. `procedure` is the instruction a subagent executes, not data
// it reads — the boundary is org ownership, so anyone holding the owner's DDISA
// identity (today: the CEO loop) can write it. Narrowing that to a grant is the
// next step; until then the injection score makes the write visible.
export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  const body = await readBody<{ role?: string, label?: string, duties?: string, procedure?: string, vars?: unknown, tools?: string[], reportsTo?: string | null, enabled?: boolean }>(event)
  const patch: Record<string, unknown> = {}
  if (typeof body?.role === 'string') patch.role = body.role.trim() || 'specialist'
  if (typeof body?.label === 'string') patch.label = body.label.trim()
  if (typeof body?.duties === 'string') patch.duties = body.duties.trim()
  if (typeof body?.procedure === 'string') patch.procedure = body.procedure.trim()
  if ('vars' in (body ?? {})) patch.vars = assertVars(body.vars)
  if (Array.isArray(body?.tools)) patch.tools = body.tools.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim())
  if ('reportsTo' in (body ?? {})) patch.reportsTo = body.reportsTo ?? null
  if (typeof body?.enabled === 'boolean') patch.enabled = body.enabled
  if (Object.keys(patch).length === 0) throw createError({ statusCode: 400, statusMessage: 'no fields' })
  await useDb().update(cockpitAgents).set(patch).where(and(eq(cockpitAgents.id, id), eq(cockpitAgents.ownerEmail, owner), eq(cockpitAgents.orgId, orgId)))
  return { ok: true }
})
