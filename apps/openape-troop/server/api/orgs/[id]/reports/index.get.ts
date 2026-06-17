import { desc, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { reports } from '../../../../database/schema'
import { requireOrgReadAccess } from '../../../../utils/orgs'

export default defineEventHandler(async (event) => {
  const { org } = await requireOrgReadAccess(event)
  const db = useDb()
  // Reverse-chronological — newest report first. Cap at 100 for now;
  // pagination can come later if a single org accumulates thousands.
  return db.select().from(reports).where(eq(reports.orgId, org.id)).orderBy(desc(reports.createdAt)).limit(100)
})
