import { defineEventHandler } from 'h3'
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { mailboxes } from '~~/server/database/schema'
import { requireAdmin } from '~~/server/utils/admin-auth'

export default defineEventHandler(async (event) => {
  const { org } = await requireAdmin(event)
  const db = useDb()

  const result = await db
    .select({
      id: mailboxes.id,
      orgId: mailboxes.orgId,
      domainId: mailboxes.domainId,
      localPart: mailboxes.localPart,
      address: mailboxes.address,
      totalSizeBytes: mailboxes.totalSizeBytes,
      softCapBytes: mailboxes.softCapBytes,
      messageCount: mailboxes.messageCount,
      createdAt: mailboxes.createdAt,
    })
    .from(mailboxes)
    .where(eq(mailboxes.orgId, org.id))
    .all()

  return result
})
