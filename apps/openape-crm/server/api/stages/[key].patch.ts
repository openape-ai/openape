import { and, eq, sql } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { isOutcome } from '#shared/stages'
import { useDb } from '../../database/drizzle'
import { deals, pipelineStages } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { listStages, parseStageName, requireStage, writePositions } from '../../utils/stages'
import { requireRole } from '../../utils/workspace-access'

interface Body {
  workspace_id?: string
  name?: string
  outcome?: string
  /** Neue Spaltenposition, 0-basiert. */
  position?: number
}

/** PATCH /api/stages/:key — rename, change outcome, reorder. */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const key = getRouterParam(event, 'key')!
  const body = await readBody<Body>(event)
  const workspaceId = body?.workspace_id
  if (!workspaceId) throw createProblemError({ status: 400, title: 'workspace_id required' })

  const db = useDb()
  await requireRole(db, workspaceId, caller.email, 'manager')
  const stage = await requireStage(db, workspaceId, key)

  const patch: { name?: string, outcome?: 'open' | 'won' | 'lost' } = {}
  if (body?.name !== undefined) patch.name = parseStageName(body.name)
  if (body?.outcome !== undefined) {
    if (!isOutcome(body.outcome)) throw createProblemError({ status: 400, title: 'outcome must be open|won|lost' })
    patch.outcome = body.outcome
  }

  if (Object.keys(patch).length) {
    await db.update(pipelineStages)
      .set(patch)
      .where(and(eq(pipelineStages.workspaceId, workspaceId), eq(pipelineStages.key, key)))
  }

  // When an open stage becomes a closing one (or the other way round), the
  // deals in it have to follow — else the card keeps claiming to be open.
  if (patch.outcome && patch.outcome !== stage.outcome) {
    const closedAt = patch.outcome === 'open' ? null : Date.now()
    await db.update(deals)
      .set({ closedAt: closedAt === null ? null : sql`COALESCE(${deals.closedAt}, ${closedAt})` })
      .where(and(eq(deals.workspaceId, workspaceId), eq(deals.stage, key)))
  }

  let position = stage.position
  if (body?.position !== undefined) {
    const stages = await listStages(db, workspaceId)
    if (!Number.isInteger(body.position) || body.position < 0 || body.position >= stages.length) {
      throw createProblemError({ status: 400, title: `position must be 0–${stages.length - 1}` })
    }
    const order = stages.map(s => s.key).filter(k => k !== key)
    order.splice(body.position, 0, key)
    await writePositions(db, workspaceId, order)
    position = body.position
  }

  return { ...stage, ...patch, position }
})
