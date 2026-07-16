import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../database/drizzle'
import { cockpitSkills } from '../../../database/schema'
import { cockpitOwner } from '../../../utils/cockpit/auth'

export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  await useDb().delete(cockpitSkills).where(and(eq(cockpitSkills.id, id), eq(cockpitSkills.ownerEmail, owner), eq(cockpitSkills.orgId, '')))
  return { ok: true }
})
