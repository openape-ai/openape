import type { ClientMetadataMode } from '@openape/auth'
import { validateRedirectUri } from '@openape/auth'
import { defineEventHandler, getQuery, getRequestURL, sendRedirect } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { getAppSession } from '../utils/session'
import { useGrantStores } from '../utils/grant-stores'
import { useIdpStores } from '../utils/stores'
import { createProblemError } from '../utils/problem'
import { findStandingCrossSpGrant, mintCrossSpCode } from '../utils/cross-sp-code'

// GET /authorize-cross-sp — redirect/code entry point for the cross-SP
// delegation spawn flow (replaces the browser-fetch + IdP-CORS path).
//
// The Receiver SP's *server* builds this URL and the browser navigates to
// it (top-level, so the Owner's IdP session cookie travels same-origin —
// no CORS, no sameSite=none). The IdP:
//   1. requires an Owner session (else bounce to /login and back)
//   2. validates redirect_uri against the SP's published metadata
//   3. finds the Owner's standing delegation grant — or sends them through
//      the existing /grant-cross-sp consent page, returning here on approve
//   4. issues a single-use, PKCE-bound signed code and redirects back
//
// Query: client_id (delegate SP host), audience (Provider host),
//        scope (single, e.g. "troop:spawn-agent"), redirect_uri, state,
//        code_challenge, code_challenge_method=S256.

function bounceError(event: any, redirectUri: string, state: string, error: string, description: string) {
  // redirect_uri is validated before we ever call this, so it's safe to
  // send the user there with the spec error params (RFC 6749 §4.1.2.1).
  const url = new URL(redirectUri)
  url.searchParams.set('error', error)
  url.searchParams.set('error_description', description)
  if (state) url.searchParams.set('state', state)
  return sendRedirect(event, url.toString())
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const clientId = String(query.client_id ?? '')
  const audience = String(query.audience ?? '')
  const scope = String(query.scope ?? '')
  const redirectUri = String(query.redirect_uri ?? '')
  const state = String(query.state ?? '')
  const codeChallenge = String(query.code_challenge ?? '')
  const codeChallengeMethod = String(query.code_challenge_method ?? '')

  if (!clientId || !audience || !scope || !redirectUri || !codeChallenge) {
    throw createProblemError({ status: 400, title: 'Missing required parameter (client_id, audience, scope, redirect_uri, code_challenge)' })
  }
  if (codeChallengeMethod !== 'S256') {
    throw createProblemError({ status: 400, title: 'code_challenge_method must be S256' })
  }

  // redirect_uri MUST be one the SP itself published — never trust it for a
  // redirect before this passes (open-redirect prevention, like /authorize).
  const config = useRuntimeConfig()
  const spMetadataMode: ClientMetadataMode = config.openapeIdp?.spMetadataMode === 'strict' ? 'strict' : 'permissive'
  const { clientMetadataStore, keyStore } = useIdpStores()
  const redirectErr = await validateRedirectUri(clientId, redirectUri, clientMetadataStore, spMetadataMode)
  if (redirectErr) {
    throw createProblemError({ status: 400, title: redirectErr.error, detail: redirectErr.detail })
  }

  // Owner session required. No session → /login, returning to this exact URL.
  const session = await getAppSession(event)
  const reqUrl = getRequestURL(event)
  const selfPathAndQuery = reqUrl.pathname + reqUrl.search
  if (!session.data.userId) {
    const loginUrl = new URL('/login', reqUrl.origin)
    loginUrl.searchParams.set('returnTo', selfPathAndQuery)
    return sendRedirect(event, loginUrl.pathname + loginUrl.search)
  }
  const owner = session.data.userId as string

  // Normalize the audience to a bare host — that's how the grant stores it
  // and how the Provider's exchange compares it (sp-data-access §3).
  let audienceHost: string
  try {
    audienceHost = new URL(audience.includes('://') ? audience : `https://${audience}`).host
  }
  catch {
    return bounceError(event, redirectUri, state, 'invalid_request', 'audience must be a valid host')
  }

  const { grantStore } = useGrantStores()
  const grant = await findStandingCrossSpGrant(grantStore, { owner, delegate: clientId, audienceHost, scope })

  if (!grant) {
    // No standing grant — send the Owner through the existing consent page.
    // return_to is THIS url, so after they approve (grant created) the flow
    // re-enters here and the grant is found → code issued.
    const consent = new URL('/grant-cross-sp', reqUrl.origin)
    consent.searchParams.set('delegate', clientId)
    consent.searchParams.set('audience', audienceHost)
    consent.searchParams.set('scopes', scope)
    consent.searchParams.set('grant_type', 'always')
    consent.searchParams.set('return_to', reqUrl.toString())
    return sendRedirect(event, consent.pathname + consent.search)
  }

  const code = await mintCrossSpCode(
    { grantId: grant.id, sub: owner, clientId, redirectUri, codeChallenge },
    keyStore,
  )
  const back = new URL(redirectUri)
  back.searchParams.set('code', code)
  if (state) back.searchParams.set('state', state)
  return sendRedirect(event, back.toString())
})
