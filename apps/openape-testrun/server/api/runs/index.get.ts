import { and, desc, eq, isNull } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { useDb } from '../../database/drizzle'
import { runs } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { publicRunUrl } from '../../utils/run-access'

/**
 * GET /api/runs — list the caller's runs, newest first (auth required).
 * Query: ?limit=50 (max 200)
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const limitRaw = Number(getQuery(event).limit)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 200) : 50

  const db = useDb()
  const rows = await db.select({
    id: runs.id,
    slug: runs.slug,
    title: runs.title,
    project: runs.project,
    status: runs.status,
    passedCount: runs.passedCount,
    failedCount: runs.failedCount,
    skippedCount: runs.skippedCount,
    createdBy: runs.createdBy,
    createdByAct: runs.createdByAct,
    createdAt: runs.createdAt,
  }).from(runs)
    .where(and(eq(runs.createdBy, caller.email), isNull(runs.deletedAt)))
    .orderBy(desc(runs.createdAt))
    .limit(limit)

  return rows.map(row => ({
    id: row.id,
    slug: row.slug,
    url: publicRunUrl(event, row.slug),
    title: row.title,
    project: row.project,
    status: row.status,
    passed: row.passedCount,
    failed: row.failedCount,
    skipped: row.skippedCount,
    created_by: row.createdBy,
    created_by_act: row.createdByAct,
    created_at: row.createdAt,
  }))
})
