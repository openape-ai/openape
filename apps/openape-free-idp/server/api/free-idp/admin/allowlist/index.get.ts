import { defineEventHandler } from 'h3'
import { eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { adminAllowlist } from '../../../../database/schema'
import { extractEmailDomain } from '../../../../utils/admin-claim'

/**
 * List the SPs allowlisted for the caller's domain. Scoped to one
 * domain because cross-domain reads would leak which SPs another
 * organisation has approved — that's metadata they may not want
 * shared. Caller must be admin (root or operator) of their domain.
 */
export default defineEventHandler(async (event) => {
  const email = await requireAdmin(event)
  const domain = extractEmailDomain(email)
  if (!domain) return []

  const db = useDb()
  return await db
    .select({
      clientId: adminAllowlist.clientId,
      approvedBy: adminAllowlist.approvedBy,
      approvedAt: adminAllowlist.approvedAt,
    })
    .from(adminAllowlist)
    .where(eq(adminAllowlist.domain, domain))
    .all()
})
