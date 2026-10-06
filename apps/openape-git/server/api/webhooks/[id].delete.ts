import { eq } from 'drizzle-orm'
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../database/drizzle'
import { repos, webhooks } from '../../database/schema'

/** DELETE /api/webhooks/:id — unsubscribe a consumer. Repo owner only. */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id') ?? ''

  const db = useDb()
  const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1)
  if (!hook) throw createError({ statusCode: 404, statusMessage: 'webhook not found' })
  const [repo] = await db.select().from(repos).where(eq(repos.id, hook.repoId)).limit(1)
  if (!repo || repo.ownerEmail !== caller.email)
    throw createError({ statusCode: 404, statusMessage: 'webhook not found' })

  await db.delete(webhooks).where(eq(webhooks.id, id))
  return { ok: true }
})
