import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { cockpitSchedules } from '../../../../database/schema'
import { requireOwnedOrg } from '../../../../utils/cockpit/org-access'

export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const rows = await useDb().select().from(cockpitSchedules).where(and(eq(cockpitSchedules.ownerEmail, owner), eq(cockpitSchedules.orgId, orgId)))
  return rows.map(s => ({ id: s.id, kind: s.kind, atHour: s.atHour, everyMinutes: s.everyMinutes, enabled: s.enabled, lastRunAt: s.lastRunAt }))
})
