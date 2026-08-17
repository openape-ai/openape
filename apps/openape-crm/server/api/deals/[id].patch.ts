import { and, eq, sql } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { useDb } from '../../database/drizzle'
import { deals } from '../../database/schema'
import { isClosedStage, parseStage, parseTitle, parseValueCents } from '../../utils/deal-shape'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'

interface Body {
  title?: string
  value_cents?: number
  stage?: string
  contact_id?: string | null
  org_id?: string | null
}

/** PATCH /api/deals/:id — Felder ändern; ein Stufenwechsel hängt den Deal ans Spaltenende. */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')!
  const body = await readBody<Body>(event)

  const db = useDb()
  const deal = await db.select().from(deals).where(eq(deals.id, id)).get()
  if (!deal) throw createProblemError({ status: 404, title: 'deal not found' })
  await requireRole(db, deal.workspaceId, caller.email)

  const patch: Partial<typeof deals.$inferInsert> = {}
  if (body?.title !== undefined) patch.title = parseTitle(body.title)
  if (body?.value_cents !== undefined) patch.valueCents = parseValueCents(body.value_cents)
  if (body?.contact_id !== undefined) patch.contactId = body.contact_id
  if (body?.org_id !== undefined) patch.orgId = body.org_id

  if (body?.stage !== undefined) {
    const stage = parseStage(body.stage)
    if (stage !== deal.stage) {
      const last = await db
        .select({ max: sql<number | null>`max(${deals.position})` })
        .from(deals)
        .where(and(eq(deals.workspaceId, deal.workspaceId), eq(deals.stage, stage)))
        .get()
      patch.position = (last?.max ?? -1) + 1
      patch.closedAt = isClosedStage(stage) ? Date.now() : null
    }
    patch.stage = stage
  }

  if (Object.keys(patch).length === 0) throw createProblemError({ status: 400, title: 'nothing to update' })

  await db.update(deals).set(patch).where(eq(deals.id, id))
  return { ...deal, ...patch }
})
