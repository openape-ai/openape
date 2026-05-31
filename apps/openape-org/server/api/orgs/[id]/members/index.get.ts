import { asc, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { orgMembers } from '../../../../database/schema'
import { requireOwnedOrg } from '../../../../utils/orgs'

export default defineEventHandler(async (event) => {
  const { org } = await requireOwnedOrg(event)
  const db = useDb()
  return db.select().from(orgMembers).where(eq(orgMembers.orgId, org.id)).orderBy(asc(orgMembers.createdAt))
})
