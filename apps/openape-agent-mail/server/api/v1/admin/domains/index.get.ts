import { defineEventHandler } from 'h3'
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { domains } from '~~/server/database/schema'
import { requireAdmin } from '~~/server/utils/admin-auth'

export default defineEventHandler(async (event) => {
  const { org } = await requireAdmin(event)
  const db = useDb()

  const result = await db
    .select()
    .from(domains)
    .where(eq(domains.orgId, org.id))
    .all()

  return result
})
