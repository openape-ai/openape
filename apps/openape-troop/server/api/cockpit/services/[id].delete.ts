import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../database/drizzle'
import { cockpitServices } from '../../../database/schema'
import { cockpitOwner } from '../../../utils/cockpit/auth'

export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  await useDb().delete(cockpitServices).where(and(eq(cockpitServices.id, id), eq(cockpitServices.ownerEmail, owner)))
  return { ok: true }
})
