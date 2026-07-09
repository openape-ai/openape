import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { cockpitSchedules } from '../../../../database/schema'
import { cockpitOwner } from '../../../../utils/cockpit/auth'

// Mark a schedule as run (sets lastRunAt=now) — the loop calls this after it
// has done the due work, so troop won't hand it out again until next time.
export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  await useDb().update(cockpitSchedules).set({ lastRunAt: Date.now() }).where(and(eq(cockpitSchedules.id, id), eq(cockpitSchedules.ownerEmail, owner)))
  return { ok: true }
})
