import { eq } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { cockpitSchedules } from '../../database/schema'
import { cockpitOwner } from '../../utils/cockpit/auth'
import { isDue } from '../../utils/cockpit/schedule'

// What is due for this owner right now — the provider loop polls this each tick
// and acts on what comes back (e.g. { kind: 'morning-report', orgId }).
export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  const now = Date.now()
  const rows = await useDb().select().from(cockpitSchedules).where(eq(cockpitSchedules.ownerEmail, owner))
  return rows
    .filter(s => isDue({ atHour: s.atHour, everyMinutes: s.everyMinutes, enabled: s.enabled, lastRunAt: s.lastRunAt }, now))
    .map(s => ({ id: s.id, orgId: s.orgId, kind: s.kind }))
})
