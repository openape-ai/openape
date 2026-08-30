import { and, eq, sql } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { deals, notes } from '../../database/schema'
import { parseTitle, parseValueCents } from '../../utils/deal-shape'
import { applyStufePatch, parseStufe } from '../../utils/pipelines'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'
import type { Phase } from '#shared/pipelines'
import { isPhase } from '#shared/pipelines'

interface Body {
  title?: string
  value_cents?: number
  stufe?: string
  contact_id?: string | null
  org_id?: string | null
}

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

  if (body?.stufe !== undefined) {
    const phase: Phase = isPhase(deal.phase) ? deal.phase : 'deal'
    parseStufe(phase, body.stufe)
    const applied = applyStufePatch({ phase, stufe: deal.stufe }, body.stufe)
    if (applied.fields.stufe !== deal.stufe || applied.fields.phase !== deal.phase) {
      const last = await db
        .select({ max: sql<number | null>`max(${deals.position})` })
        .from(deals)
        .where(and(
          eq(deals.workspaceId, deal.workspaceId),
          eq(deals.phase, applied.fields.phase),
          eq(deals.stufe, applied.fields.stufe),
        ))
        .get()
      patch.position = (last?.max ?? -1) + 1
    }
    patch.phase = applied.fields.phase
    patch.stufe = applied.fields.stufe
    patch.stage = applied.fields.stufe
    patch.closedAt = applied.fields.closedAt
    if (applied.log) {
      await db.insert(notes).values({
        id: ulid(),
        workspaceId: deal.workspaceId,
        dealId: deal.id,
        authorEmail: caller.email,
        kind: 'notiz',
        title: applied.log.title,
        body: applied.log.body,
        createdAt: Date.now(),
      })
    }
  }

  if (Object.keys(patch).length === 0) throw createProblemError({ status: 400, title: 'nothing to update' })

  await db.update(deals).set(patch).where(eq(deals.id, id))
  return { ...deal, ...patch, phase: patch.phase ?? deal.phase, stufe: patch.stufe ?? deal.stufe }
})
