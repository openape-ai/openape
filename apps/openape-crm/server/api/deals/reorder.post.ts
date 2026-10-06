import { and, eq, inArray } from 'drizzle-orm'
import { defineEventHandler, readBody } from 'h3'
import { useDb } from '../../database/drizzle'
import { deals } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { requireStage } from '../../utils/stages'
import { requireRole } from '../../utils/workspace-access'

const MAX_IDS = 500

/**
 * POST /api/deals/reorder — der Client schickt die neue Reihenfolge EINER
 * Spalte; der Server schreibt Stufe und Position aller genannten Deals neu.
 * One call per drop, even when the card changed column.
 * Body: { workspace_id, stage, ids: string[] }
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<{ workspace_id?: string, stage?: string, ids?: string[] }>(event)

  const workspaceId = body?.workspace_id
  if (!workspaceId) throw createProblemError({ status: 400, title: 'workspace_id required' })
  const ids = body?.ids
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) {
    throw createProblemError({ status: 400, title: `ids must be 1–${MAX_IDS} deal ids` })
  }

  const db = useDb()
  await requireRole(db, workspaceId, caller.email)
  const stage = await requireStage(db, workspaceId, body?.stage)

  // Foreign ids must not ride along: only what really sits in THIS workspace
  // gets written.
  const owned = await db
    .select({ id: deals.id, stage: deals.stage, closedAt: deals.closedAt })
    .from(deals)
    .where(and(eq(deals.workspaceId, workspaceId), inArray(deals.id, ids)))
    .all()
  const known = new Map(owned.map(r => [r.id, r]))
  if (ids.some(id => !known.has(id))) throw createProblemError({ status: 404, title: 'unknown deal id' })

  const now = Date.now()
  await Promise.all(ids.map((id, position) => {
    const current = known.get(id)!
    // A deal that already closed keeps its closing date — merely
    // reordering inside "won" must not push it to today.
    const closedAt = stage.outcome === 'open' ? null : current.closedAt ?? now
    return db.update(deals)
      .set({ stage: stage.key, position, closedAt })
      .where(and(eq(deals.id, id), eq(deals.workspaceId, workspaceId)))
  }))

  return { stage: stage.key, count: ids.length }
})
