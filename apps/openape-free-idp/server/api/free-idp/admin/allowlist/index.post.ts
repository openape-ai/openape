import { defineEventHandler, readBody } from 'h3'
import { useDb } from '../../../../database/drizzle'
import { adminAllowlist } from '../../../../database/schema'
import { extractEmailDomain } from '../../../../utils/admin-claim'

/**
 * Allowlist a SP for the caller's domain (mode=allowlist-admin
 * gating). Idempotent — re-adding the same client_id refreshes
 * approvedAt / approvedBy.
 */
export default defineEventHandler(async (event) => {
  const email = await requireAdmin(event)
  const domain = extractEmailDomain(email)
  if (!domain) {
    throw createProblemError({ status: 400, title: 'Caller has no email domain' })
  }

  const body = await readBody<{ clientId?: string }>(event)
  const clientId = String(body?.clientId ?? '').trim().toLowerCase()
  if (!clientId) {
    throw createProblemError({ status: 400, title: 'clientId is required' })
  }
  // Loose shape check: client_id is typically a hostname per DDISA
  // §4.3, but RFC 7591 leaves it opaque. Reject anything with
  // whitespace / control chars, otherwise accept.
  if (!/^[\w.-]+$/.test(clientId) || clientId.length > 255) {
    throw createProblemError({ status: 400, title: 'clientId has invalid format' })
  }

  const now = Math.floor(Date.now() / 1000)
  await useDb()
    .insert(adminAllowlist)
    .values({ domain, clientId, approvedBy: email.toLowerCase(), approvedAt: now })
    .onConflictDoUpdate({
      target: [adminAllowlist.domain, adminAllowlist.clientId],
      set: { approvedBy: email.toLowerCase(), approvedAt: now },
    })
    .run()

  return { domain, clientId, approvedBy: email, approvedAt: now }
})
