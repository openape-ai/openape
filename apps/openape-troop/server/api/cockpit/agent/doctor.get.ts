import { eq } from 'drizzle-orm'
import { useDb } from '../../../database/drizzle'
import { cockpitAgents } from '../../../database/schema'
import { requireCockpitAgent } from '../../../utils/cockpit/auth'
import { cliNamesFromToolPatterns } from '../../../utils/cockpit/doctor'

// The worker's preflight checklist: every CLI the owner's team declares across
// all orgs. The worker resolves each via `command -v` in its REAL environment
// and reports the result with its next heartbeat.
export default defineEventHandler(async (event) => {
  const owner = await requireCockpitAgent(event)
  const rows = await useDb().select({ tools: cockpitAgents.tools, enabled: cockpitAgents.enabled }).from(cockpitAgents).where(eq(cockpitAgents.ownerEmail, owner))
  const patterns = rows.filter(r => r.enabled).flatMap(r => r.tools)
  return { clis: cliNamesFromToolPatterns(patterns) }
})
