import { and, eq, inArray } from 'drizzle-orm'
import { defineEventHandler, readBody } from 'h3'
import { useDb } from '../../database/drizzle'
import { deals } from '../../database/schema'
import { applyStufePatch, parsePhase, parseStufe } from '../../utils/pipelines'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'
import type { Phase } from '#shared/pipelines'
import { isPhase } from '#shared/pipelines'

const MAX_IDS = 500

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<{ workspace_id?: string, stage?: string, stufe?: string, phase?: string, ids?: string[] }>(event)

  const workspaceId = body?.workspace_id
  if (!workspaceId) throw createProblemError({ status: 400, title: 'workspace_id required' })
  const ids = body?.ids
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) {
    throw createProblemError({ status: 400, title: `ids must be 1–${MAX_IDS} deal ids` })
  }

  const db = useDb()
  await requireRole(db, workspaceId, caller.email)

  const owned = await db
    .select({ id: deals.id, phase: deals.phase, stufe: deals.stufe, closedAt: deals.closedAt })
    .from(deals)
    .where(and(eq(deals.workspaceId, workspaceId), inArray(deals.id, ids)))
    .all()
  const known = new Map(owned.map(r => [r.id, r]))
  if (ids.some(id => !known.has(id))) throw createProblemError({ status: 404, title: 'unknown deal id' })

  const sample = known.get(ids[0]!)!
  const phase: Phase = body?.phase
    ? parsePhase(body.phase)
    : (isPhase(sample.phase) ? sample.phase : 'deal')
  const stufe = parseStufe(phase, body?.stufe ?? body?.stage)

  const now = Date.now()
  await Promise.all(ids.map((id, position) => {
    const current = known.get(id)!
    const currentPhase: Phase = isPhase(current.phase) ? current.phase : 'deal'
    const applied = applyStufePatch({ phase: currentPhase, stufe: current.stufe }, stufe, now)
    return db.update(deals)
      .set({
        phase: applied.fields.phase,
        stufe: applied.fields.stufe,
        stage: applied.fields.stufe,
        position,
        closedAt: applied.fields.closedAt,
      })
      .where(and(eq(deals.id, id), eq(deals.workspaceId, workspaceId)))
  }))

  return { phase, stufe, count: ids.length }
})
