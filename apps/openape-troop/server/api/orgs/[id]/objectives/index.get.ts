import { asc, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { objectives } from '../../../../database/schema'
import { requireOwnedOrg } from '../../../../utils/orgs'

export default defineEventHandler(async (event) => {
  const { org } = await requireOwnedOrg(event)
  const db = useDb()
  return db.select().from(objectives).where(eq(objectives.orgId, org.id)).orderBy(asc(objectives.createdAt))
})
