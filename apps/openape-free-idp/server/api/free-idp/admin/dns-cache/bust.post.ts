import { defineEventHandler, getQuery } from 'h3'
import { clearDNSCacheFor } from '@openape/core'
import { extractEmailDomain } from '../../../../utils/admin-claim'

/**
 * Bust the in-memory DDISA TXT-record cache for a specific bare
 * domain. Useful right after the user updates `_ddisa.{domain}`
 * via DNS and wants the IdP to pick it up immediately rather than
 * waiting for the 300s positive (or 60s negative) cache TTL.
 *
 * Gated by `requireRootAdmin` because cache busting is only useful
 * for someone who controls the DNS for that domain — and the DNS
 * controller is exactly who establishes root-admin via the
 * `_openape-admin-{idp}.{domain}` claim. Operators (DB-promoted)
 * shouldn't need this; they don't manage DNS.
 *
 * Caller can omit `?domain=` to default to their own email domain,
 * which is the common case. Cross-domain bust is allowed for root
 * admins but requires explicit `?domain=` to avoid accidents.
 */
export default defineEventHandler(async (event) => {
  const callerEmail = await requireRootAdmin(event)
  const query = getQuery(event)
  const target = String(query.domain ?? '').trim().toLowerCase()
    || extractEmailDomain(callerEmail)
  if (!target) {
    throw createProblemError({ status: 400, title: 'No domain to bust' })
  }
  const wasCached = clearDNSCacheFor(target)
  return { domain: target, wasCached }
})
