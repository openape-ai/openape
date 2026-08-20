import { and, eq, inArray } from 'drizzle-orm'
import { defineEventHandler, readBody } from 'h3'
import { useDb } from '../../database/drizzle'
import { deals } from '../../database/schema'
import { isClosedStage, parseStage } from '../../utils/deal-shape'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'

const MAX_IDS = 500

/**
 * POST /api/deals/reorder — der Client schickt die neue Reihenfolge EINER
 * Spalte; der Server schreibt Stufe und Position aller genannten Deals neu.
 * Ein Aufruf pro Drop, auch wenn die Karte die Spalte gewechselt hat.
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
  const stage = parseStage(body?.stage)

  const db = useDb()
  await requireRole(db, workspaceId, caller.email)

  // Fremde IDs dürfen nicht mitwandern: nur was wirklich in DIESEM Workspace
  // liegt, wird geschrieben.
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
    // Ein bereits abgeschlossener Deal behält sein Abschlussdatum — bloßes
    // Umsortieren innerhalb „Gewonnen" darf es nicht auf heute schieben.
    const closedAt = isClosedStage(stage) ? current.closedAt ?? now : null
    return db.update(deals)
      .set({ stage, position, closedAt })
      .where(and(eq(deals.id, id), eq(deals.workspaceId, workspaceId)))
  }))

  return { stage, count: ids.length }
})
