import { randomUUID } from 'node:crypto'
import { useDb } from '../../../../database/drizzle'
import { cockpitSchedules } from '../../../../database/schema'
import { requireOwnedOrg } from '../../../../utils/cockpit/org-access'

// Define a schedule for this org: daily at a Vienna hour (atHour) OR periodic
// (everyMinutes). The provider loop discovers it via /api/cockpit/due.
export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const body = await readBody<{ kind?: string, atHour?: number, everyMinutes?: number }>(event)
  const kind = (body?.kind ?? '').trim()
  if (!kind) throw createError({ statusCode: 400, statusMessage: 'kind required' })
  const atHour = typeof body?.atHour === 'number' ? Math.max(0, Math.min(23, Math.floor(body.atHour))) : null
  const everyMinutes = typeof body?.everyMinutes === 'number' && body.everyMinutes > 0 ? Math.floor(body.everyMinutes) : null
  if (atHour == null && everyMinutes == null) throw createError({ statusCode: 400, statusMessage: 'atHour or everyMinutes required' })
  const row = { id: randomUUID(), ownerEmail: owner, orgId, kind, atHour, everyMinutes, enabled: true, lastRunAt: null, createdAt: Date.now() }
  await useDb().insert(cockpitSchedules).values(row)
  return { id: row.id, kind, atHour, everyMinutes, enabled: true }
})
