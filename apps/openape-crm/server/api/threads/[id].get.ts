import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../database/drizzle'
import { threadMessages, threads } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')!
  const db = useDb()
  const thread = await db.select().from(threads).where(eq(threads.id, id)).get()
  if (!thread) throw createProblemError({ status: 404, title: 'thread not found' })
  await requireRole(db, thread.workspaceId, caller.email)
  const messages = await db
    .select({
      id: threadMessages.id,
      from_address: threadMessages.fromAddress,
      body: threadMessages.body,
      created_at: threadMessages.createdAt,
    })
    .from(threadMessages)
    .where(eq(threadMessages.threadId, id))
    .all()
  return {
    id: thread.id,
    deal_id: thread.dealId,
    subject: thread.subject,
    status: thread.status,
    source: thread.source,
    created_at: thread.createdAt,
    messages,
  }
})
