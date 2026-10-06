import { desc, eq, or } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { useDb } from '../../database/drizzle'
import { secretRequests } from '../../database/schema'
import { callerEmail } from '../../utils/access'
import { toRequestView } from '../../utils/request-view'

/**
 * GET /api/requests — everything this caller is party to: the ones waiting on
 * them, and the ones they raised. Metadata only; the envelope never appears in
 * a listing.
 */
export default defineEventHandler(async (event) => {
  const caller = await callerEmail(event)
  const rows = await useDb().select().from(secretRequests).where(or(eq(secretRequests.ownerEmail, caller), eq(secretRequests.requester, caller))).orderBy(desc(secretRequests.createdAt))
  return rows.map(toRequestView)
})
