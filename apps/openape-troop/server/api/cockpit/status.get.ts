import { and, eq } from 'drizzle-orm'
import { agentStatus } from '../../utils/cockpit/queue'
import { cockpitOwner } from '../../utils/cockpit/auth'
import { useDb } from '../../database/drizzle'
import { cockpitAgents } from '../../database/schema'
import { cliNamesFromToolPatterns } from '../../utils/cockpit/doctor'

// The owner's Operator brain state — drives the header indicator (live / Ruhemodus
// +countdown / arbeitet / offline). With ?company=<orgId> the doctor warning is
// scoped to THAT org's declared tools — the OpenApe chat must not warn about a
// CLI only IURIO uses (#996). Without the param: owner-wide (admin view).
export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  const company = String(getQuery(event).company ?? '')
  let scope: Set<string> | undefined
  if (company) {
    const rows = await useDb().select({ tools: cockpitAgents.tools, enabled: cockpitAgents.enabled }).from(cockpitAgents).where(and(eq(cockpitAgents.ownerEmail, owner), eq(cockpitAgents.orgId, company)))
    scope = new Set(cliNamesFromToolPatterns(rows.filter(r => r.enabled).flatMap(r => r.tools)))
  }
  return agentStatus(owner, scope)
})
