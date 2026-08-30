import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { useDb } from '../../database/drizzle'
import { threads } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'

const STATUSES = ['neu', 'warten_kunde', 'warten_uns', 'abgeschlossen'] as const

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ status?: string, deal_id?: string | null }>(event)
  const db = useDb()
  const thread = await db.select().from(threads).where(eq(threads.id, id)).get()
  if (!thread) throw createProblemError({ status: 404, title: 'thread not found' })
  await requireRole(db, thread.workspaceId, caller.email)
  const patch: Partial<typeof threads.$inferInsert> = {}
  if (body?.status !== undefined) {
    if (!(STATUSES as readonly string[]).includes(body.status)) {
      throw createProblemError({ status: 400, title: 'unknown thread status' })
    }
    patch.status = body.status
  }
  if (body?.deal_id !== undefined) patch.dealId = body.deal_id
  if (Object.keys(patch).length === 0) throw createProblemError({ status: 400, title: 'nothing to update' })
  await db.update(threads).set(patch).where(eq(threads.id, id))
  return { id, ...patch }
})
