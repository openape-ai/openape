import { defineEventHandler } from 'h3'
import { getAppSession } from '../../utils/session'
import { useIdpStores } from '../../utils/stores'
import { createProblemError } from '../../utils/problem'

interface PendingConsent {
  params: {
    client_id: string
    redirect_uri: string
    state: string
    [k: string]: unknown
  }
  query: Record<string, string>
  csrfToken: string
  createdAt: number
}

/**
 * Render-data feed for the `/consent` page. Returns:
 *   - the SP info (client_id, redirect_uri) for display
 *   - the resolved client metadata (name, logo, …) when published —
 *     decides verified-vs-unverified branch in the UI
 *   - the CSRF token the page must echo back in its POST
 *
 * Reads exclusively from the session — never trusts query params for
 * the redirect_uri or client_id (those would let a phishing link
 * forge a "logging in to chat.openape.ai" UI when in fact the session
 * holds a different SP).
 */
export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  if (!session.data.userId) {
    throw createProblemError({ status: 401, title: 'Not authenticated' })
  }

  const pending = (session.data as { pendingConsent?: PendingConsent }).pendingConsent
  if (!pending) {
    throw createProblemError({ status: 404, title: 'No pending consent in session' })
  }

  const { clientMetadataStore } = useIdpStores()
  const metadata = await clientMetadataStore.resolve(pending.params.client_id).catch(() => null)

  return {
    csrfToken: pending.csrfToken,
    clientId: pending.params.client_id,
    redirectUri: pending.params.redirect_uri,
    verified: !!metadata,
    metadata: metadata
      ? {
          client_name: metadata.client_name,
          client_uri: metadata.client_uri ?? null,
          logo_uri: metadata.logo_uri ?? null,
          policy_uri: metadata.policy_uri ?? null,
          tos_uri: metadata.tos_uri ?? null,
        }
      : null,
  }
})
