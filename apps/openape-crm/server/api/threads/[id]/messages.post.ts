import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../database/drizzle'
import { notes, threadMessages, threads } from '../../../database/schema'
import { requireGraphAccess } from '../../../utils/graph-account'
import { buildSendMailBody, graphJson } from '../../../utils/graph'
import { createProblemError } from '../../../utils/problem'
import { requireRole } from '../../../utils/workspace-access'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ body?: string, to?: string }>(event)
  const text = body?.body?.trim()
  if (!text) throw createProblemError({ status: 400, title: 'body required' })
  const db = useDb()
  const thread = await db.select().from(threads).where(eq(threads.id, id)).get()
  if (!thread) throw createProblemError({ status: 404, title: 'thread not found' })
  await requireRole(db, thread.workspaceId, caller.email)
  const graph = await requireGraphAccess(caller.email)
  const to = body?.to?.trim()
  if (!to) throw createProblemError({ status: 400, title: 'to required' })
  await graphJson(graph.accessToken, '/me/sendMail', {
    method: 'POST',
    body: JSON.stringify(buildSendMailBody({ to: [to], subject: `Re: ${thread.subject}`, body: text })),
  })
  const now = Date.now()
  const msgId = ulid()
  await db.insert(threadMessages).values({
    id: msgId,
    threadId: id,
    fromAddress: graph.mail || caller.email,
    body: text,
    createdAt: now,
  })
  if (thread.dealId) {
    await db.insert(notes).values({
      id: ulid(),
      workspaceId: thread.workspaceId,
      dealId: thread.dealId,
      authorEmail: caller.email,
      kind: 'mail',
      title: `Antwort: ${thread.subject}`,
      body: text,
      createdAt: now,
    })
  }
  setResponseStatus(event, 201)
  return { id: msgId }
})
