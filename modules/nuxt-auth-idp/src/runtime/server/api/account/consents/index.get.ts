import { defineEventHandler } from 'h3'
import { getAppSession } from '../../../utils/session'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

/**
 * List the SPs the authenticated user has approved via the
 * `allowlist-user` consent flow (DDISA core.md §2.3, #301).
 *
 * Each entry is enriched with the SP's published name when
 * available. SP-supplied images (`logo_uri`) are intentionally
 * NOT forwarded — see consent.get.ts for the rationale.
 */
export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  if (!session.data.userId) {
    throw createProblemError({ status: 401, title: 'Not authenticated' })
  }

  const { consentStore, clientMetadataStore } = useIdpStores()
  const entries = await consentStore.list(session.data.userId)

  // Resolve metadata in parallel — caller only sees aggregated rows.
  const enriched = await Promise.all(entries.map(async (entry) => {
    const metadata = await clientMetadataStore.resolve(entry.clientId).catch(() => null)
    return {
      clientId: entry.clientId,
      grantedAt: entry.grantedAt,
      verified: !!metadata,
      clientName: metadata?.client_name ?? null,
      clientUri: metadata?.client_uri ?? null,
    }
  }))

  return enriched
})
