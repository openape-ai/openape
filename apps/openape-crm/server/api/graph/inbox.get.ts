import { inArray } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { recipientAddresses } from '#shared/graph-live'
import { matchInboxAddresses } from '#shared/inbox'
import { useDb } from '../../database/drizzle'
import { contactEmails, contacts, threads } from '../../database/schema'
import { listInbox } from '../../utils/graph'
import { requireGraphAccess } from '../../utils/graph-account'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const graph = await requireGraphAccess(caller.email)
  const db = useDb()
  const messages = await listInbox(graph.accessToken)
  const emailRows = await db.select().from(contactEmails).all()
  const contactRows = await db.select().from(contacts).all()
  const contactEmailRows = [
    ...emailRows.map(e => ({ contactId: e.contactId, email: e.email })),
    ...contactRows.filter(c => c.email).map(c => ({ contactId: c.id, email: c.email! })),
  ]
  const self = graph.mail || caller.email
  const internetIds = messages.map(msg => msg.internetMessageId || msg.id)
  const linkedRows = internetIds.length
    ? await db.select({
        id: threads.id,
        deal_id: threads.dealId,
        internet_message_id: threads.internetMessageId,
      }).from(threads).where(inArray(threads.internetMessageId, internetIds)).all()
    : []
  const linkedById = new Map(linkedRows.map(r => [r.internet_message_id, r]))

  return messages.map((msg) => {
    const from = msg.from?.emailAddress?.address || ''
    const to = recipientAddresses(msg.toRecipients)
    const cc = recipientAddresses(msg.ccRecipients)
    const match = matchInboxAddresses({ from, to, cc, selfMail: self, contactEmails: contactEmailRows })
    const linked = linkedById.get(msg.internetMessageId || msg.id) ?? null
    return {
      id: msg.id,
      internet_message_id: msg.internetMessageId || null,
      subject: msg.subject || '(ohne Betreff)',
      preview: msg.bodyPreview || '',
      from,
      from_name: msg.from?.emailAddress?.name || null,
      received_at: msg.receivedDateTime || null,
      matched_contact_id: match?.contactId ?? null,
      matched_email: match?.email ?? null,
      thread_id: linked?.id ?? null,
      deal_id: linked?.deal_id ?? null,
    }
  })
})
