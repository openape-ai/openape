import { createDelegation } from '@openape/grants'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { requireAuth } from '../utils/admin'
import { tryBearerAuth } from '../utils/agent-auth'
import { useGrantStores } from '../utils/grant-stores'
import { createProblemError } from '../utils/problem'

// POST /api/grant-cross-sp — Owner-initiated cross-SP standing-grant
// creation, called from the /grant-cross-sp consent page when the Owner
// clicks Approve.
//
// Why a dedicated route instead of reusing /api/delegations:
// /api/delegations is the generic delegation-CRUD surface (lists, deletes,
// `act='human'` gate). The consent flow has narrower needs: it always
// creates a single fresh delegation tied to the active session, never
// from a CLI bearer, and we don't want it caught by future scope
// restrictions on /api/delegations (e.g. when we lock that down to
// only-our-agents). Keeping the consent endpoint separate also makes
// auditing cleaner — every row created here came through a browser
// consent screen with the Owner's eyeballs on the scope card.
//
// Request:
//   { delegate: string, audience: string, scopes?: string[],
//     grant_type: 'once'|'timed'|'always', duration?: number }
//
// Response: the created OpenApeGrant (id is what the Receiver SP needs).

export default defineEventHandler(async (event) => {
  // Browser-session only — bearer tokens are intentionally rejected so
  // an agent can never call this endpoint and forge a standing grant
  // without the Owner's consent UI.
  const bearer = await tryBearerAuth(event)
  if (bearer) {
    throw createProblemError({
      status: 403,
      title: 'Cross-SP consent requires browser session, not bearer',
    })
  }
  const delegator = await requireAuth(event)
  const body = await readBody(event)

  if (!body?.delegate || typeof body.delegate !== 'string') {
    throw createProblemError({ status: 400, title: 'Missing delegate' })
  }
  if (!body?.audience || typeof body.audience !== 'string') {
    throw createProblemError({ status: 400, title: 'Missing audience' })
  }
  const grantType = body.grant_type
  if (!['once', 'timed', 'always'].includes(grantType)) {
    throw createProblemError({ status: 400, title: 'Invalid grant_type' })
  }

  // Normalize audience to bare host. The consent page passes whatever
  // the Receiver gave us in the query string ('troop.openape.ai',
  // 'https://troop.openape.ai/'). Bare-host is what the Provider's
  // exchange endpoint compares against, per sp-data-access §3.
  let audience: string
  try {
    audience = new URL(body.audience.includes('://') ? body.audience : `https://${body.audience}`).host
  }
  catch {
    throw createProblemError({ status: 400, title: 'audience must be a valid host' })
  }

  const scopes = Array.isArray(body.scopes)
    ? body.scopes.filter((s: unknown): s is string => typeof s === 'string' && s.length > 0)
    : undefined
  if (scopes && scopes.length === 0) {
    throw createProblemError({ status: 400, title: 'scopes must be non-empty if provided' })
  }

  const { grantStore } = useGrantStores()
  const grant = await createDelegation({
    delegator,
    delegate: body.delegate,
    audience,
    scopes,
    grant_type: grantType,
    duration: typeof body.duration === 'number' ? body.duration : undefined,
  }, grantStore)

  setResponseStatus(event, 201)
  return grant
})
