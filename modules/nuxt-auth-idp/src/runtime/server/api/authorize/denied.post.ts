import { defineEventHandler } from 'h3'
import { getAppSession } from '../../utils/session'
import { createProblemError } from '../../utils/problem'

interface PendingDeny {
  params: {
    client_id: string
    redirect_uri: string
    state: string
    [k: string]: unknown
  }
  query: Record<string, string>
  reason: string
  createdAt: number
}

/**
 * Complete the OAuth-spec deny redirect (RFC 6749 §4.1.2.1) — the
 * /denied page calls this when the user clicks the "back to SP"
 * button. Returns `{ location }` JSON so the page can do a top-
 * level navigation (same pattern as consent.post for the same
 * Fetch-spec-redirect-headers reason). The redirect_uri comes
 * straight from the session (set by /authorize after we already
 * validated it against the SP's published metadata) — never from
 * client input.
 */
export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  const pending = (session.data as { pendingDeny?: PendingDeny }).pendingDeny
  if (!pending) {
    throw createProblemError({
      status: 400,
      title: 'No pending deny in session',
    })
  }

  // Single-shot — clear the state regardless. Replaying isn't a
  // security issue here (the redirect just delivers an error to the
  // SP) but stale state has no purpose either.
  await session.update({ pendingDeny: undefined })

  const url = new URL(pending.params.redirect_uri)
  url.searchParams.set('error', 'access_denied')
  if (pending.params.state) url.searchParams.set('state', pending.params.state)
  return { location: url.toString() }
})
