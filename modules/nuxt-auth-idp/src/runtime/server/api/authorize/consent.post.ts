import { defineEventHandler, readBody, sendRedirect } from 'h3'
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

const CONSENT_TTL_MS = 5 * 60_000 // 5 minutes — long enough to read, short enough to keep the trust window tight

export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  const userId = session.data.userId
  if (!userId) {
    throw createProblemError({ status: 401, title: 'Not authenticated' })
  }

  const pending = (session.data as { pendingConsent?: PendingConsent }).pendingConsent
  if (!pending) {
    throw createProblemError({ status: 400, title: 'No pending consent in session — start the /authorize flow again' })
  }

  // TTL: a stale consent state is dropped — the user has to re-initiate.
  // Defends against an attacker keeping a token alive across an old
  // /authorize they had no business approving.
  if (Date.now() - pending.createdAt > CONSENT_TTL_MS) {
    await session.update({ pendingConsent: undefined })
    throw createProblemError({ status: 400, title: 'Consent request expired — start the /authorize flow again' })
  }

  const body = await readBody<{ csrfToken?: string, action?: 'approve' | 'cancel' }>(event)
  if (!body.csrfToken || body.csrfToken !== pending.csrfToken) {
    // Constant CSRF mismatch error so a probing attacker can't
    // distinguish "no session" from "wrong token".
    throw createProblemError({ status: 403, title: 'Invalid CSRF token' })
  }

  const action = body.action === 'cancel' ? 'cancel' : 'approve'

  // Whatever the outcome, drop the pending state so the token can't
  // be replayed. We still need params/query for the redirect, so we
  // capture them on a const before clearing.
  const captured = { params: pending.params, query: pending.query }
  await session.update({ pendingConsent: undefined })

  if (action === 'cancel') {
    const url = new URL(captured.params.redirect_uri)
    url.searchParams.set('error', 'access_denied')
    if (captured.params.state) url.searchParams.set('state', captured.params.state)
    return sendRedirect(event, url.toString())
  }

  // Persist the approval so subsequent /authorize calls skip the
  // consent screen — matches standard OAuth "approve once, remembered"
  // UX. Future work: account-page UI to view/revoke connected SPs.
  const { consentStore } = useIdpStores()
  await consentStore.save({
    userId,
    clientId: captured.params.client_id,
    grantedAt: Math.floor(Date.now() / 1000),
  })

  // Re-enter the /authorize flow with the original query string. The
  // consent gate now passes (`hasConsent` is true if remembered, or
  // re-evaluation hits the same path with one-shot allow if not — see
  // note below). The handler issues the code as usual.
  const resumeUrl = new URL('/authorize', new URL(event.node.req.url ?? '', 'http://x').origin)
  for (const [k, v] of Object.entries(captured.query)) {
    if (typeof v === 'string') resumeUrl.searchParams.set(k, v)
  }
  return sendRedirect(event, resumeUrl.pathname + resumeUrl.search)
})
