import { and, desc, eq, gte } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { costSnapshots } from '../../../../database/schema'
import { requireOrgReadAccess } from '../../../../utils/orgs'

// Default window: last 30 days. Used by the cost dashboard for the
// rolling-budget meter + spend-trend chart.
export default defineEventHandler(async (event) => {
  const { org } = await requireOrgReadAccess(event)
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  const db = useDb()
  return db.select().from(costSnapshots).where(and(eq(costSnapshots.orgId, org.id), gte(costSnapshots.day, cutoff))).orderBy(desc(costSnapshots.day))
})
