import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { useDb } from '../../database/drizzle'
import { tasks } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ status?: string, title?: string }>(event)
  const db = useDb()
  const row = await db.select().from(tasks).where(eq(tasks.id, id)).get()
  if (!row) throw createProblemError({ status: 404, title: 'task not found' })
  await requireRole(db, row.workspaceId, caller.email)
  const patch: Partial<typeof tasks.$inferInsert> = {}
  if (body?.status === 'offen' || body?.status === 'erledigt') patch.status = body.status
  if (body?.title !== undefined) {
    const title = body.title.trim()
    if (!title || title.length > 200) throw createProblemError({ status: 400, title: 'title must be 1–200 chars' })
    patch.title = title
  }
  if (Object.keys(patch).length === 0) throw createProblemError({ status: 400, title: 'nothing to update' })
  await db.update(tasks).set(patch).where(eq(tasks.id, id))
  return { id, ...patch }
})
