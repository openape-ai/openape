import { and, eq, sql } from 'drizzle-orm'
import { defineEventHandler, getQuery, getRouterParam } from 'h3'
import { useDb } from '../../database/drizzle'
import { deals, pipelineStages } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { listStages, requireStage, writePositions } from '../../utils/stages'
import { requireRole } from '../../utils/workspace-access'

/**
 * DELETE /api/stages/:key?workspace_id=…&move_to=… — Stufe entfernen.
 * If deals sit in it, `move_to` is required: no deal disappears silently.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const key = getRouterParam(event, 'key')!
  const query = getQuery(event)
  const workspaceId = String(query.workspace_id ?? '')
  if (!workspaceId) throw createProblemError({ status: 400, title: 'workspace_id required' })

  const db = useDb()
  await requireRole(db, workspaceId, caller.email, 'manager')
  await requireStage(db, workspaceId, key)

  const stages = await listStages(db, workspaceId)
  if (stages.length === 1) {
    throw createProblemError({ status: 409, title: 'the last stage cannot be deleted' })
  }

  const inStage = await db
    .select({ count: sql<number>`count(*)` })
    .from(deals)
    .where(and(eq(deals.workspaceId, workspaceId), eq(deals.stage, key)))
    .get()
  const affected = inStage?.count ?? 0

  if (affected > 0) {
    const target = await requireStage(db, workspaceId, String(query.move_to ?? ''))
    if (target.key === key) throw createProblemError({ status: 400, title: 'move_to must be another stage' })

    const last = await db
      .select({ max: sql<number | null>`max(${deals.position})` })
      .from(deals)
      .where(and(eq(deals.workspaceId, workspaceId), eq(deals.stage, target.key)))
      .get()

    const moving = await db
      .select({ id: deals.id, closedAt: deals.closedAt })
      .from(deals)
      .where(and(eq(deals.workspaceId, workspaceId), eq(deals.stage, key)))
      .orderBy(deals.position)
      .all()

    const now = Date.now()
    let position = (last?.max ?? -1) + 1
    for (const deal of moving) {
      await db.update(deals)
        .set({
          stage: target.key,
          position: position++,
          closedAt: target.outcome === 'open' ? null : deal.closedAt ?? now,
        })
        .where(eq(deals.id, deal.id))
    }
  }

  await db.delete(pipelineStages)
    .where(and(eq(pipelineStages.workspaceId, workspaceId), eq(pipelineStages.key, key)))
  await writePositions(db, workspaceId, stages.map(s => s.key).filter(k => k !== key))

  return { key, moved: affected }
})
