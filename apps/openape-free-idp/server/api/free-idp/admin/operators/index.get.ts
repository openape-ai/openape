import { defineEventHandler } from 'h3'
import { eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { operators } from '../../../../database/schema'
import { extractEmailDomain } from '../../../../utils/admin-claim'

/**
 * List operators for the caller's domain. Visible to root admins
 * (DNS-rooted) and to operators themselves (so they can see who
 * else has the same scope they do). Operators are scoped per
 * domain, so the list never leaks across tenants.
 */
export default defineEventHandler(async (event) => {
  const email = await requireAdmin(event)
  const domain = extractEmailDomain(email)
  if (!domain) return []

  return await useDb()
    .select({
      userEmail: operators.userEmail,
      promotedBy: operators.promotedBy,
      promotedAt: operators.promotedAt,
    })
    .from(operators)
    .where(eq(operators.domain, domain))
    .all()
})
