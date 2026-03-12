import { createError, defineEventHandler, getRouterParam } from 'h3'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { messages } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const mailbox = event.context.mailbox
  const id = getRouterParam(event, 'id')!
  const db = useDb()

  const message = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, id), eq(messages.mailboxId, mailbox.id)))
    .get()

  if (!message) {
    throw createError({ statusCode: 404, statusMessage: 'Message not found' })
  }

  return message
})
