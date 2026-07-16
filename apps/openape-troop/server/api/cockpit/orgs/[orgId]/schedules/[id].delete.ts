import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../../database/drizzle'
import { cockpitSchedules } from '../../../../../database/schema'
import { requireOwnedOrg } from '../../../../../utils/cockpit/org-access'

export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  await useDb().delete(cockpitSchedules).where(and(eq(cockpitSchedules.id, id), eq(cockpitSchedules.ownerEmail, owner), eq(cockpitSchedules.orgId, orgId)))
  return { ok: true }
})
