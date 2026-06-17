import { asc, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { objectives } from '../../../../database/schema'
import { requireOrgReadAccess } from '../../../../utils/orgs'

export default defineEventHandler(async (event) => {
  const { org } = await requireOrgReadAccess(event)
  const db = useDb()
  return db.select().from(objectives).where(eq(objectives.orgId, org.id)).orderBy(asc(objectives.createdAt))
})
