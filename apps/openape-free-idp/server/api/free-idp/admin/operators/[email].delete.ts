import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { operators } from '../../../../database/schema'
import { clearAdminCache, extractEmailDomain } from '../../../../utils/admin-claim'

/**
 * Demote an operator. Root-admin only — see operators.post.ts for
 * the security rationale (operators promoting/demoting each other
 * lets one compromise propagate).
 */
export default defineEventHandler(async (event) => {
  const callerEmail = await requireRootAdmin(event)
  const domain = extractEmailDomain(callerEmail)
  if (!domain) {
    throw createProblemError({ status: 400, title: 'Caller has no email domain' })
  }

  const target = decodeURIComponent(getRouterParam(event, 'email') ?? '').toLowerCase()
  if (!target) {
    throw createProblemError({ status: 400, title: 'email is required' })
  }

  await useDb()
    .delete(operators)
    .where(and(
      eq(operators.userEmail, target),
      eq(operators.domain, domain),
    ))
    .run()

  clearAdminCache(target, domain)
  setResponseStatus(event, 204)
})
