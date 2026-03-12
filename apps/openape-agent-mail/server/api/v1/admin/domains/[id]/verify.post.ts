import { createError, defineEventHandler, getRouterParam } from 'h3'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { domains } from '~~/server/database/schema'
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

  if (!domain.resendDomainId) {
    throw createError({ statusCode: 400, statusMessage: 'Domain has no transport ID' })
  }

  const transport = useTransport()
  const { status } = await transport.verifyDomain(domain.resendDomainId)

  await db
    .update(domains)
    .set({ status })
    .where(eq(domains.id, id))

  return { id, domain: domain.domain, status }
})
