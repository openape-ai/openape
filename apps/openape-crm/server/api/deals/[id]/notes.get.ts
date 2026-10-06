import { desc, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../database/drizzle'
import { deals, notes } from '../../../database/schema'
import { createProblemError } from '../../../utils/problem'
import { requireRole } from '../../../utils/workspace-access'

/** GET /api/deals/:id/notes — notes on the deal, newest first. */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const dealId = getRouterParam(event, 'id')!

  const db = useDb()
  const deal = await db.select().from(deals).where(eq(deals.id, dealId)).get()
  if (!deal) throw createProblemError({ status: 404, title: 'deal not found' })
  await requireRole(db, deal.workspaceId, caller.email)

  return await db
    .select({
      id: notes.id,
      body: notes.body,
      author_email: notes.authorEmail,
      created_at: notes.createdAt,
    })
    .from(notes)
    .where(eq(notes.dealId, dealId))
    .orderBy(desc(notes.createdAt))
    .all()
})
