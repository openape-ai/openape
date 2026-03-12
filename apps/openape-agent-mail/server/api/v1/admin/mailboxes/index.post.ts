import { createError, defineEventHandler, readBody } from 'h3'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { domains, mailboxes } from '~~/server/database/schema'
import { requireAdmin } from '~~/server/utils/admin-auth'
import { generateApiKey } from '~~/server/utils/api-key'

export default defineEventHandler(async (event) => {
  const { org } = await requireAdmin(event)
  const body = await readBody<{ localPart: string, domainId: string }>(event)

  const localPart = body?.localPart?.trim()?.toLowerCase()
  if (!localPart || !/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(localPart)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid local part' })
  }

  if (!body?.domainId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing domainId' })
  }

  const db = useDb()

  const domain = await db
    .select()
    .from(domains)
    .where(and(eq(domains.id, body.domainId), eq(domains.orgId, org.id)))
    .get()

  if (!domain) {
    throw createError({ statusCode: 404, statusMessage: 'Domain not found' })
  }

  if (domain.status !== 'verified') {
    throw createError({ statusCode: 400, statusMessage: 'Domain not verified' })
  }

  // Check mailbox limit
  const existing = await db
    .select()
    .from(mailboxes)
    .where(eq(mailboxes.orgId, org.id))
    .all()

  if (existing.length >= (org.maxMailboxes ?? 5)) {
    throw createError({ statusCode: 400, statusMessage: 'Mailbox limit reached' })
  }

  const address = `${localPart}@${domain.domain}`

  // Check uniqueness
  const duplicate = await db
    .select()
    .from(mailboxes)
    .where(eq(mailboxes.address, address))
    .get()

  if (duplicate) {
    throw createError({ statusCode: 409, statusMessage: 'Address already exists' })
  }

  const { key, hash } = generateApiKey()
  const id = crypto.randomUUID()
  const softCapBytes = (org.mailboxSizeMb ?? 30) * 1024 * 1024

  await db.insert(mailboxes).values({
    id,
    orgId: org.id,
    domainId: domain.id,
    localPart,
    address,
    apiKeyHash: hash,
    softCapBytes,
    createdAt: new Date(),
  })

  // Return API key only once — it cannot be retrieved again
  return { id, address, apiKey: key }
})
