import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../database/drizzle'
import { deals, notes } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'

/** DELETE /api/deals/:id — Deal samt seiner Notizen entfernen. */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')!

  const db = useDb()
  const deal = await db.select().from(deals).where(eq(deals.id, id)).get()
  if (!deal) throw createProblemError({ status: 404, title: 'deal not found' })
  await requireRole(db, deal.workspaceId, caller.email)

  await db.delete(notes).where(eq(notes.dealId, id))
  await db.delete(deals).where(eq(deals.id, id))
  return { deleted: true }
})
