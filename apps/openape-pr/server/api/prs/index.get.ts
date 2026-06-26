import { desc, isNull } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { useDb } from '../../database/drizzle'
import { prs } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'

/**
 * GET /api/prs — list PRs for review, newest first (auth required).
 *
 * A human reviewer sees every open PR (reviewing is the whole point); the
 * list is not scoped to the caller. Query: ?status=pending|reviewed, ?limit=50.
 */
export default defineEventHandler(async (event) => {
  await requireCaller(event)
  const query = getQuery(event)
  const limitRaw = Number(query.limit)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 200) : 50
  const statusFilter = query.status === 'pending' || query.status === 'reviewed' ? query.status : undefined

  const db = useDb()
  let rows = await db.select({
    id: prs.id,
    slug: prs.slug,
    title: prs.title,
    author: prs.author,
    branch: prs.branch,
    status: prs.status,
    filesCount: prs.filesCount,
    additions: prs.additions,
    deletions: prs.deletions,
    createdBy: prs.createdBy,
    createdByAct: prs.createdByAct,
    createdAt: prs.createdAt,
  }).from(prs)
    .where(isNull(prs.deletedAt))
    .orderBy(desc(prs.createdAt))
    .limit(limit)

  if (statusFilter) rows = rows.filter(r => r.status === statusFilter)

  return rows.map(row => ({
    id: row.id,
    title: row.title,
    author: row.author,
    branch: row.branch,
    status: row.status,
    files: row.filesCount,
    additions: row.additions,
    deletions: row.deletions,
    created_by: row.createdBy,
    created_by_act: row.createdByAct,
    created_at: row.createdAt,
  }))
})
