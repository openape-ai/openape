import { asc, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { orgMembers } from '../../../../database/schema'
import { requireOrgReadAccess } from '../../../../utils/orgs'

// Members of an org, oldest first (owner-only). Ported from openape-org (B0).
export default defineEventHandler(async (event) => {
  const { org } = await requireOrgReadAccess(event)
  const db = useDb()
  return db.select().from(orgMembers).where(eq(orgMembers.orgId, org.id)).orderBy(asc(orgMembers.createdAt))
})
