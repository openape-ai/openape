import { eq } from 'drizzle-orm'
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../database/drizzle'
import { mirrors, repos } from '../../database/schema'

/** DELETE /api/mirrors/:id — stop replicating to that forge. Repo owner only. */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id') ?? ''

  const db = useDb()
  const [mirror] = await db.select().from(mirrors).where(eq(mirrors.id, id)).limit(1)
  if (!mirror) throw createError({ statusCode: 404, statusMessage: 'mirror not found' })
  const [repo] = await db.select().from(repos).where(eq(repos.id, mirror.repoId)).limit(1)
  if (!repo || repo.ownerEmail !== caller.email)
    throw createError({ statusCode: 404, statusMessage: 'mirror not found' })

  await db.delete(mirrors).where(eq(mirrors.id, id))
  return { ok: true }
})
