import { randomUUID } from 'node:crypto'
import { useDb } from '../../../../database/drizzle'
import { cockpitAgents } from '../../../../database/schema'
import { requireOwnedOrg } from '../../../../utils/cockpit/org-access'
import { scoreProcedure } from '../../../../utils/cockpit/procedure-score'
import { assertVars } from '../../../../utils/cockpit/vars'

// Add a delegation leaf (role, duties, tools) the CEO can hand tool-work to.
// `procedure` is its work instruction, `vars` its own facts — both owner-only.
export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const body = await readBody<{ role?: string, label?: string, duties?: string, procedure?: string, vars?: unknown, tools?: string[], reportsTo?: string }>(event)
  const label = (body?.label ?? '').trim()
  if (!label) throw createError({ statusCode: 400, statusMessage: 'label required' })
  const tools = Array.isArray(body?.tools) ? body.tools.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim()) : []
  const procedure = (body?.procedure ?? '').trim()
  const { score, reason } = scoreProcedure(procedure, owner)
  const row = {
    id: randomUUID(),
    ownerEmail: owner,
    orgId,
    role: (body?.role ?? 'specialist').trim() || 'specialist',
    label,
    duties: (body?.duties ?? '').trim(),
    procedure,
    vars: 'vars' in (body ?? {}) ? assertVars(body.vars) : {},
    injectionScore: score,
    injectionReason: reason,
    tools,
    reportsTo: body?.reportsTo ?? null,
    enabled: true,
    createdAt: Date.now(),
  }
  await useDb().insert(cockpitAgents).values(row)
  return { id: row.id, role: row.role, label: row.label, duties: row.duties, procedure: row.procedure, vars: row.vars, injectionScore: row.injectionScore, injectionReason: row.injectionReason, tools: row.tools, reportsTo: row.reportsTo, enabled: row.enabled }
})
