import { defineEventHandler, getQuery } from 'h3'
import { desc, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { messages } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const mailbox = event.context.mailbox
  const query = getQuery(event)

  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100)
  const offset = Math.max(Number(query.offset) || 0, 0)

  const db = useDb()

  const result = await db
    .select({
      id: messages.id,
      direction: messages.direction,
      fromAddr: messages.fromAddr,
      toAddr: messages.toAddr,
      subject: messages.subject,
      sizeBytes: messages.sizeBytes,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.mailboxId, mailbox.id))
    .orderBy(desc(messages.createdAt))
    .limit(limit)
    .offset(offset)
    .all()

  return {
    messages: result,
    limit,
    offset,
  }
})
