import { eq } from 'drizzle-orm'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { attachTarget, messageBodyText } from '#shared/graph-live'
import { useDb } from '../../database/drizzle'
import { contacts, deals, notes, threadMessages, threads } from '../../database/schema'
import { getMessage } from '../../utils/graph'
import { requireGraphAccess } from '../../utils/graph-account'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<{
    workspace_id?: string
    message_id?: string
    deal_id?: string | null
    contact_id?: string | null
  }>(event)
  const workspaceId = body?.workspace_id?.trim()
  const messageId = body?.message_id?.trim()
  const target = attachTarget(body?.deal_id, body?.contact_id)
  if (!workspaceId || !messageId || !target) {
    throw createProblemError({ status: 400, title: 'workspace_id, message_id and deal_id or contact_id required' })
  }
  const db = useDb()
  await requireRole(db, workspaceId, caller.email)
  if (target.dealId) {
    const deal = await db.select().from(deals).where(eq(deals.id, target.dealId)).get()
    if (!deal || deal.workspaceId !== workspaceId) throw createProblemError({ status: 404, title: 'deal not found' })
  }
  if (target.contactId) {
    const contact = await db.select().from(contacts).where(eq(contacts.id, target.contactId)).get()
    if (!contact || contact.workspaceId !== workspaceId) throw createProblemError({ status: 404, title: 'contact not found' })
  }
  const graph = await requireGraphAccess(caller.email)
  const msg = await getMessage(graph.accessToken, messageId)
  const internetId = msg.internetMessageId || msg.id
  const existing = await db.select().from(threads).where(eq(threads.internetMessageId, internetId)).get()
  if (existing) {
    if (target.dealId && existing.dealId !== target.dealId) {
      await db.update(threads).set({ dealId: target.dealId }).where(eq(threads.id, existing.id))
    }
    return { id: existing.id, created: false }
  }
  const text = messageBodyText(msg)
  const from = msg.from?.emailAddress?.address || ''
  const now = Date.now()
  const threadId = ulid()
  await db.insert(threads).values({
    id: threadId,
    workspaceId,
    dealId: target.dealId,
    subject: msg.subject || '(ohne Betreff)',
    status: 'neu',
    source: 'mail',
    internetMessageId: internetId,
    createdAt: now,
  })
  await db.insert(threadMessages).values({
    id: ulid(),
    threadId,
    fromAddress: from || 'unbekannt',
    body: text,
    createdAt: now,
  })
  if (target.dealId) {
    await db.insert(notes).values({
      id: ulid(),
      workspaceId,
      dealId: target.dealId,
      authorEmail: from || caller.email,
      kind: 'mail',
      title: msg.subject || 'E-Mail',
      body: text,
      createdAt: now,
    })
  }
  setResponseStatus(event, 201)
  return { id: threadId, created: true, contact_id: target.contactId }
})
