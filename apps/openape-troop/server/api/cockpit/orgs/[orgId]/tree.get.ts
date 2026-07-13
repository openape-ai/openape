import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { cockpitAgents, organizations } from '../../../../database/schema'
import { requireOwnedOrg } from '../../../../utils/cockpit/org-access'
import { buildOrgTree } from '../../../../utils/cockpit/tree'

// The company's employee hierarchy as a tree — read by the orchestration loop
// (the CEO walks it: teamleads → their reports). Each node carries its work
// instruction (`procedure`) and the vars it needs, so the loop never reads a
// file off the operator's disk. Owner/agent bearer scoped.
export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const db = useDb()
  const [org] = await db.select({ vars: organizations.vars }).from(organizations).where(and(eq(organizations.id, orgId), eq(organizations.ownerEmail, owner)))
  const rows = await db.select().from(cockpitAgents).where(and(eq(cockpitAgents.ownerEmail, owner), eq(cockpitAgents.orgId, orgId)))
  const flat = rows.map(r => ({ id: r.id, role: r.role, label: r.label, duties: r.duties, procedure: r.procedure, vars: r.vars, tools: r.tools, enabled: r.enabled, reportsTo: r.reportsTo, injectionScore: r.injectionScore, injectionReason: r.injectionReason }))
  return { roots: buildOrgTree(flat, org?.vars ?? {}) }
})
