import { createError, defineEventHandler, getRouterParam } from 'h3'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { mailboxes, messages } from '~~/server/database/schema'
import { requireAdmin } from '~~/server/utils/admin-auth'

export default defineEventHandler(async (event) => {
  const { org } = await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  const db = useDb()

  const mailbox = await db
    .select()
    .from(mailboxes)
    .where(and(eq(mailboxes.id, id), eq(mailboxes.orgId, org.id)))
    .get()

  if (!mailbox) {
    throw createError({ statusCode: 404, statusMessage: 'Mailbox not found' })
  }

  // Delete all messages first, then the mailbox
  await db.delete(messages).where(eq(messages.mailboxId, id))
  await db.delete(mailboxes).where(eq(mailboxes.id, id))

  return { ok: true }
})
