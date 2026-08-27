import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { matchInboxAddresses } from '#shared/inbox'
import { contactEmails, contacts, dealContacts, deals, notes, threadMessages, threads } from '../database/schema'
import type { InboxMessage } from './graph'

type Db = ReturnType<typeof import('../database/drizzle').useDb>

export async function ingestInboxMessages(
  db: Db,
  opts: { workspaceId: string, selfMail: string, messages: InboxMessage[] },
): Promise<{ ingested: number, skipped: number }> {
  const emails = await db.select().from(contactEmails).all()
  const workspaceContacts = await db.select().from(contacts).where(eq(contacts.workspaceId, opts.workspaceId)).all()
  const contactIds = new Set(workspaceContacts.map(c => c.id))
  const contactEmailRows = [
    ...emails.filter(e => contactIds.has(e.contactId)).map(e => ({ contactId: e.contactId, email: e.email })),
    ...workspaceContacts.filter(c => c.email).map(c => ({ contactId: c.id, email: c.email! })),
  ]
  const dealLinks = await db.select().from(dealContacts).all()
  const dealRows = await db.select().from(deals).where(eq(deals.workspaceId, opts.workspaceId)).all()
  const dealsByContact = new Map<string, { id: string, createdAt: number }[]>()
  for (const link of dealLinks) {
    const deal = dealRows.find(d => d.id === link.dealId)
    if (!deal) continue
    const list = dealsByContact.get(link.contactId) ?? []
    list.push({ id: deal.id, createdAt: deal.createdAt })
    dealsByContact.set(link.contactId, list)
  }
  for (const deal of dealRows) {
    if (deal.contactId) {
      const list = dealsByContact.get(deal.contactId) ?? []
      list.push({ id: deal.id, createdAt: deal.createdAt })
      dealsByContact.set(deal.contactId, list)
    }
  }

  let ingested = 0
  let skipped = 0
  for (const msg of opts.messages) {
    const internetId = msg.internetMessageId || msg.id
    if (internetId) {
      const existing = await db.select({ id: threads.id }).from(threads).where(eq(threads.internetMessageId, internetId)).get()
      if (existing) {
        skipped++
        continue
      }
    }
    const from = msg.from?.emailAddress?.address || ''
    const to = (msg.toRecipients ?? []).map(r => r.emailAddress?.address || '').filter(Boolean)
    const cc = (msg.ccRecipients ?? []).map(r => r.emailAddress?.address || '').filter(Boolean)
    const match = matchInboxAddresses({
      from,
      to,
      cc,
      selfMail: opts.selfMail,
      contactEmails: contactEmailRows,
    })
    if (!match) {
      skipped++
      continue
    }
    const body = msg.body?.content || msg.bodyPreview || ''
    const candidates = dealsByContact.get(match.contactId) ?? []
    const dealId = candidates.sort((a, b) => b.createdAt - a.createdAt)[0]?.id ?? null
    const now = Date.now()
    const threadId = ulid()
    await db.insert(threads).values({
      id: threadId,
      workspaceId: opts.workspaceId,
      dealId,
      subject: msg.subject || '(ohne Betreff)',
      status: 'neu',
      source: 'mail',
      internetMessageId: internetId,
      createdAt: now,
    })
    await db.insert(threadMessages).values({
      id: ulid(),
      threadId,
      fromAddress: from || match.email,
      body,
      createdAt: now,
    })
    if (dealId) {
      await db.insert(notes).values({
        id: ulid(),
        workspaceId: opts.workspaceId,
        dealId,
        authorEmail: from || match.email,
        kind: 'mail',
        title: msg.subject || 'E-Mail',
        body,
        createdAt: now,
      })
    }
    ingested++
  }
  return { ingested, skipped }
}
