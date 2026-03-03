import { createError, defineEventHandler, getHeader } from 'h3'
import { eq } from 'drizzle-orm'
import { hashApiKey } from '../utils/api-key'
import { useDb } from '../utils/db'
import { mailboxes } from '../database/schema'

export default defineEventHandler(async (event) => {
  const path = event.path

  // Only apply to agent API endpoints (not admin, not webhooks)
  if (!path.startsWith('/api/v1/messages') && path !== '/api/v1/mailbox') return

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader?.startsWith('Bearer amk_')) {
    throw createError({ statusCode: 401, statusMessage: 'Missing or invalid API key' })
  }

  const apiKey = authHeader.slice('Bearer '.length)
  const hash = hashApiKey(apiKey)
  const db = useDb()

  const mailbox = await db
    .select()
    .from(mailboxes)
    .where(eq(mailboxes.apiKeyHash, hash))
    .get()

  if (!mailbox) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid API key' })
  }

  // Attach mailbox to event context for downstream handlers
  event.context.mailbox = mailbox
})
