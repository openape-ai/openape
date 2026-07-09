import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../database/drizzle'
import { cockpitServices } from '../../../database/schema'
import { cockpitOwner } from '../../../utils/cockpit/auth'

export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ enabled?: boolean }>(event)
  if (!id || typeof body?.enabled !== 'boolean')
    throw createError({ statusCode: 400, statusMessage: 'id + enabled required' })
  await useDb().update(cockpitServices).set({ enabled: body.enabled }).where(and(eq(cockpitServices.id, id), eq(cockpitServices.ownerEmail, owner)))
  return { ok: true }
})
