import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { adminAllowlist } from '../../../../database/schema'
import { extractEmailDomain } from '../../../../utils/admin-claim'

export default defineEventHandler(async (event) => {
  const email = await requireAdmin(event)
  const domain = extractEmailDomain(email)
  if (!domain) {
    throw createProblemError({ status: 400, title: 'Caller has no email domain' })
  }

  const clientId = decodeURIComponent(getRouterParam(event, 'clientId') ?? '').toLowerCase()
  if (!clientId) {
    throw createProblemError({ status: 400, title: 'clientId is required' })
  }

  await useDb()
    .delete(adminAllowlist)
    .where(and(
      eq(adminAllowlist.domain, domain),
      eq(adminAllowlist.clientId, clientId),
    ))
    .run()

  setResponseStatus(event, 204)
})
