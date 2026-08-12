import { desc, eq } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { useDb } from '../../database/drizzle'
import { kpis } from '../../database/schema'
import { latestPerKey, scopeMatches } from '../../utils/kpi-shape'

// ponytail: newest 1000 rows, filtered in JS — an owner's KPI volume is tiny;
// move filtering into SQL when a real owner outgrows this.
const MAX_ROWS = 1000

/**
 * GET /api/kpis — the caller's own KPIs, newest first. There is no cross-owner
 * view. Query: `latest=1` → newest row per (scope, key); `scope=` → prefix
 * filter on the scope path; `since=<unix ms>` → only newer rows.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const q = getQuery(event)

  let rows = await useDb()
    .select()
    .from(kpis)
    .where(eq(kpis.owner, caller.email))
    .orderBy(desc(kpis.createdAt))
    .limit(MAX_ROWS)

  const since = Number(q.since)
  if (Number.isFinite(since) && since > 0)
    rows = rows.filter(r => r.createdAt >= since)

  const scope = typeof q.scope === 'string' && q.scope ? q.scope : null
  if (scope)
    rows = rows.filter(r => scopeMatches(r.scope, scope))

  if (q.latest !== undefined)
    rows = latestPerKey(rows)

  return { kpis: rows }
})
