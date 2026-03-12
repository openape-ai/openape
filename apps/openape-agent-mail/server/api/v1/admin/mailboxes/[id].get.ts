import { createError, defineEventHandler, getRouterParam } from 'h3'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { mailboxes } from '~~/server/database/schema'
import { requireAdmin } from '~~/server/utils/admin-auth'

export default defineEventHandler(async (event) => {
  const { org } = await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  const db = useDb()

  const mailbox = await db
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
    .where(and(eq(mailboxes.id, id), eq(mailboxes.orgId, org.id)))
    .get()

  if (!mailbox) {
    throw createError({ statusCode: 404, statusMessage: 'Mailbox not found' })
  }

  return mailbox
})
