import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../../database/drizzle'
import { cockpitAgents } from '../../../../../database/schema'
import { requireOwnedOrg } from '../../../../../utils/cockpit/org-access'

export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  await useDb().delete(cockpitAgents).where(and(eq(cockpitAgents.id, id), eq(cockpitAgents.ownerEmail, owner), eq(cockpitAgents.orgId, orgId)))
  return { ok: true }
})
