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
 * Render-data feed for the /denied page. Returns the SP context so
 * the page can show the user where they tried to log in, the deny
 * reason for copy variation, and (later) the trusted redirect URI
 * to navigate to when the user clicks the OAuth-spec "back to SP"
 * button. Reads exclusively from the session — never from query
 * params — so a phishing link can't fake the SP context.
 */
export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  const pending = (session.data as { pendingDeny?: PendingDeny }).pendingDeny
  if (!pending) {
    throw createProblemError({
      status: 404,
      title: 'No pending deny in session — start the /authorize flow again',
    })
  }

  return {
    clientId: pending.params.client_id,
    reason: pending.reason,
  }
})
