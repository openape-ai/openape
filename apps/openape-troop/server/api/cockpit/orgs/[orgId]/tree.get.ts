import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { cockpitAgents } from '../../../../database/schema'
import { requireOwnedOrg } from '../../../../utils/cockpit/org-access'
import { buildOrgTree } from '../../../../utils/cockpit/tree'

// The company's employee hierarchy as a tree — read by the orchestration loop
// (the CEO walks it: teamleads → their reports). Owner/agent bearer scoped.
export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const rows = await useDb().select().from(cockpitAgents).where(and(eq(cockpitAgents.ownerEmail, owner), eq(cockpitAgents.orgId, orgId)))
  return { roots: buildOrgTree(rows.map(r => ({ id: r.id, role: r.role, label: r.label, duties: r.duties, tools: r.tools, enabled: r.enabled, reportsTo: r.reportsTo }))) }
})
