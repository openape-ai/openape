import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../../database/drizzle'
import { cockpitSkills } from '../../../../../database/schema'
import { requireOwnedOrg } from '../../../../../utils/cockpit/org-access'

export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  await useDb().delete(cockpitSkills).where(and(eq(cockpitSkills.id, id), eq(cockpitSkills.ownerEmail, owner), eq(cockpitSkills.orgId, orgId)))
  return { ok: true }
})
