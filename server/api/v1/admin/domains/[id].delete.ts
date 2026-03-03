import { createError, defineEventHandler, getRouterParam } from 'h3'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { domains, mailboxes, messages } from '~~/server/database/schema'
import { requireAdmin } from '~~/server/utils/admin-auth'
import { useTransport } from '~~/server/utils/transport'

export default defineEventHandler(async (event) => {
  const { org } = await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  const db = useDb()

  const domain = await db
    .select()
    .from(domains)
    .where(and(eq(domains.id, id), eq(domains.orgId, org.id)))
    .get()

  if (!domain) {
    throw createError({ statusCode: 404, statusMessage: 'Domain not found' })
  }

  // Cascade: delete messages → mailboxes → domain
  const domainMailboxes = await db
    .select({ id: mailboxes.id })
    .from(mailboxes)
    .where(eq(mailboxes.domainId, id))
    .all()

  for (const mb of domainMailboxes) {
    await db.delete(messages).where(eq(messages.mailboxId, mb.id))
  }
  await db.delete(mailboxes).where(eq(mailboxes.domainId, id))

  if (domain.resendDomainId) {
    const transport = useTransport()
    await transport.deleteDomain(domain.resendDomainId)
  }

  await db.delete(domains).where(eq(domains.id, id))

  return { ok: true }
})
