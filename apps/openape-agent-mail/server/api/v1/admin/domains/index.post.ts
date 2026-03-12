import { createError, defineEventHandler, readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { domains } from '~~/server/database/schema'
import { requireAdmin } from '~~/server/utils/admin-auth'
import { useTransport } from '~~/server/utils/transport'

export default defineEventHandler(async (event) => {
  const { org } = await requireAdmin(event)
  const body = await readBody<{ domain: string }>(event)

  const domain = body?.domain?.trim()?.toLowerCase()
  if (!domain || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(domain)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid domain' })
  }

  const transport = useTransport()
  const { id: resendDomainId, dnsRecords } = await transport.createDomain(domain)

  const id = crypto.randomUUID()
  const db = useDb()

  await db.insert(domains).values({
    id,
    orgId: org.id,
    domain,
    resendDomainId,
    dnsRecords,
    createdAt: new Date(),
  })

  return { id, domain, resendDomainId, dnsRecords, status: 'pending' }
})
