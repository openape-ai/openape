import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { cockpitAgents } from '../../../../database/schema'
import { requireOwnedOrg } from '../../../../utils/cockpit/org-access'

// The CEO's delegation team for one org.
export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const rows = await useDb().select().from(cockpitAgents).where(and(eq(cockpitAgents.ownerEmail, owner), eq(cockpitAgents.orgId, orgId)))
  return rows.map(r => ({ id: r.id, role: r.role, label: r.label, duties: r.duties, tools: r.tools, reportsTo: r.reportsTo, enabled: r.enabled }))
})
