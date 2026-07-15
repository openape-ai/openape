import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../../database/drizzle'
import { memory } from '../../../../../database/schema'
import { requireOwnedOrg } from '../../../../../utils/cockpit/org-access'

export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  await useDb().delete(memory).where(and(eq(memory.id, id), eq(memory.ownerEmail, owner), eq(memory.orgId, orgId)))
  return { ok: true }
})
