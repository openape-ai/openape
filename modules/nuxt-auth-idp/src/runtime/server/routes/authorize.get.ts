// Canonical: @openape/server createAuthorizeHandler
import type { AuthorizeParams, ClientMetadataMode } from '@openape/auth'
import type { ActorType, DelegationActClaim, OpenApeAuthorizationDetail } from '@openape/core'
import { defineEventHandler, getQuery, getRequestURL, sendRedirect } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { extractDomain, resolveDDISA } from '@openape/core'
import { evaluatePolicy, validateAuthorizeRequest, validateRedirectUri } from '@openape/auth'
import { useGrant, validateDelegation } from '@openape/grants'
import { tryBearerAuth } from '../utils/agent-auth'
import { getAppSession } from '../utils/session'
import { useIdpStores } from '../utils/stores'
import { useGrantStores } from '../utils/grant-stores'
import { createProblemError } from '../utils/problem'

function parseAuthorizationDetails(raw: string | undefined): OpenApeAuthorizationDetail[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (d: unknown): d is OpenApeAuthorizationDetail =>
        typeof d === 'object'
        && d !== null
        && ['openape_grant', 'openape_cli'].includes(String((d as Record<string, unknown>).type ?? ''))
        && typeof (d as Record<string, unknown>).action === 'string',
    )
  }
  catch {
    return []
  }
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const { codeStore } = useIdpStores()

  const params: AuthorizeParams = {
    client_id: String(query.client_id ?? ''),
    redirect_uri: String(query.redirect_uri ?? ''),
    state: String(query.state ?? ''),
    code_challenge: String(query.code_challenge ?? ''),
    code_challenge_method: String(query.code_challenge_method ?? ''),
    nonce: query.nonce ? String(query.nonce) : undefined,
    response_type: String(query.response_type ?? ''),
    scope: String(query.scope ?? ''),
  }

  const error = validateAuthorizeRequest(params)
  if (error) {
    // RFC 6749 §4.1.2.1: redirect with error params when redirect_uri is valid
    if (params.redirect_uri) {
      try {
        const errorUrl = new URL(params.redirect_uri)
        errorUrl.searchParams.set('error', 'invalid_request')
        errorUrl.searchParams.set('error_description', error)
        if (params.state) {
          errorUrl.searchParams.set('state', params.state)
        }
        return sendRedirect(event, errorUrl.toString())
      }
      catch {
        // Invalid redirect_uri — fall through to createProblemError
      }
    }
    throw createProblemError({ status: 400, title: error })
  }

  // SP redirect_uri validation per DDISA core.md §5.2.1 (#280).
  //
  // The IdP fetches the SP's published metadata at
  // https://{client_id}/.well-known/oauth-client-metadata and verifies
  // the request's redirect_uri matches one the SP itself declared. The
  // SP — not the IdP — is the source of truth; this isn't a registry,
  // it's structural enforcement of the spec's MUST. Rollout is
  // permissive-by-default so existing SPs can publish their metadata
  // without breaking; flip OPENAPE_IDP_SP_METADATA_MODE=strict once
  // the rollout is complete.
  //
  // We do NOT redirect on this error: the request's redirect_uri is
  // by definition untrusted at this point, so sending the user there
  // would itself be the open-redirect we're trying to prevent.
  const config = useRuntimeConfig()
  const spMetadataMode = (config.openapeIdp?.spMetadataMode === 'strict')
    ? 'strict' as ClientMetadataMode
    : 'permissive' as ClientMetadataMode
  const { clientMetadataStore } = useIdpStores()
  const redirectErr = await validateRedirectUri(
    params.client_id,
    params.redirect_uri,
    clientMetadataStore,
    spMetadataMode,
  )
  if (redirectErr) {
    throw createProblemError({
      status: 400,
      title: redirectErr.error,
      detail: redirectErr.detail,
    })
  }

  // Determine userId: Bearer Token (agent or human) or Human Session
  const bearerPayload = await tryBearerAuth(event)
  let userId: string
  let actorType: ActorType | undefined
  let delegationAct: DelegationActClaim | undefined
  let delegationGrantId: string | undefined

  // Check for explicit delegation_grant parameter
  const delegationGrantParam = String(query.delegation_grant ?? '')

  if (bearerPayload) {
    if (delegationGrantParam) {
      // Bearer token with explicit delegation grant
      const { grantStore } = useGrantStores()
      const grant = await validateDelegation(
        delegationGrantParam,
        bearerPayload.sub,
        params.client_id,
        grantStore,
      )
      // sub becomes the delegator, act becomes the delegate
      userId = grant.request.delegator!
      delegationAct = { sub: bearerPayload.sub }
      delegationGrantId = grant.id
      // Consume grant (once → used, timed/always → noop)
      await useGrant(grant.id, grantStore)
    }
    else {
      // Standard bearer mode
      userId = bearerPayload.sub
      actorType = bearerPayload.act === 'agent' ? 'agent' : undefined
    }
  }
  else {
    const session = await getAppSession(event)
    const loginHint = String(query.login_hint ?? '')
    if (!session.data.userId || (loginHint && session.data.userId !== loginHint)) {
      const returnTo = `/authorize?${new URLSearchParams(query as Record<string, string>).toString()}`
      await session.update({ pendingAuthorize: params, returnTo })
      const loginUrl = new URL('/login', getRequestURL(event).origin)
      loginUrl.searchParams.set('returnTo', returnTo)
      if (loginHint) {
        loginUrl.searchParams.set('login_hint', loginHint)
      }
      return sendRedirect(event, loginUrl.pathname + loginUrl.search)
    }

    if (delegationGrantParam) {
      // Human with explicit delegation grant (e.g. Lisa acting as Patrick)
      const { grantStore } = useGrantStores()
      const grant = await validateDelegation(
        delegationGrantParam,
        session.data.userId,
        params.client_id,
        grantStore,
      )
      userId = grant.request.delegator!
      delegationAct = { sub: session.data.userId }
      delegationGrantId = grant.id
      await useGrant(grant.id, grantStore)
    }
    else {
      userId = session.data.userId
    }
  }

  const userDomain = extractDomain(userId)
  const ddisaRecord = await resolveDDISA(userDomain)
  // DDISA core.md §5.6: when the user's `_ddisa.{domain}` TXT record
  // omits `mode` (or no record exists at all), the IdP picks the
  // default. The spec recommends prompting for consent. Defaulting to
  // `open` would silently issue assertions for any SP that asks —
  // safe only for users who deliberately opted into permissive mode
  // via DNS, which is exactly the inverse of what a missing record
  // means. We pass `undefined` through to evaluatePolicy whose
  // `default:` branch returns `'consent'`.
  const policyMode = ddisaRecord?.mode
  const { consentStore } = useIdpStores()
  const decision = await evaluatePolicy(policyMode, params.client_id, userId, consentStore)

  if (decision === 'deny') {
    const redirectUrl = new URL(params.redirect_uri)
    redirectUrl.searchParams.set('error', 'access_denied')
    redirectUrl.searchParams.set('state', params.state)
    return sendRedirect(event, redirectUrl.toString())
  }

  if (decision === 'consent') {
    // DDISA core.md §2.3 `allowlist-user` mode: stash the original
    // /authorize query in the session and redirect the user to the
    // consent page. The page reads the stashed state, renders the SP
    // info (using clientMetadataStore for verified-vs-unverified UI),
    // and POSTs a CSRF-token-protected confirmation back. On approve
    // the consent is persisted (so the user isn't asked again) and we
    // bounce the user back to /authorize, which re-evaluates and now
    // sees `decision === 'allow'`. See issue #301.
    if (!bearerPayload) {
      const session = await getAppSession(event)
      const csrfToken = crypto.randomUUID()
      await session.update({
        pendingConsent: {
          params,
          query: query as Record<string, string>,
          csrfToken,
          createdAt: Date.now(),
        },
      })
      const consentUrl = new URL('/consent', getRequestURL(event).origin)
      // The csrf token is *not* in the URL — only in the session, so
      // it's never logged. The consent page POSTs the token from the
      // form back, server compares against the session.
      consentUrl.searchParams.set('client_id', params.client_id)
      return sendRedirect(event, consentUrl.pathname + consentUrl.search)
    }
    // Bearer flow can't show a consent UI — agents must use explicit
    // grant API instead. Falls through to access_denied.
    const redirectUrl = new URL(params.redirect_uri)
    redirectUrl.searchParams.set('error', 'consent_required')
    redirectUrl.searchParams.set('state', params.state)
    return sendRedirect(event, redirectUrl.toString())
  }

  // RFC 9396 `authorization_details` is intentionally NOT honoured in
  // the /authorize GET path. The historical implementation auto-approved
  // arbitrary grant details whenever the parameter was present, treating
  // the user's existing IdP session as implicit consent. That meant a
  // crafted URL — `<a href="https://idp/authorize?...&authorization_details=[<broad cli grant>]">` —
  // could silently approve grants server-side via top-level GET navigation
  // (cookies are SameSite=Lax by default), bypassing the approver-policy
  // entirely. See security audit 2026-05-04 / GitHub issue #273.
  //
  // Until a proper consent UI lands (issue #273 follow-up), callers must
  // use the explicit grant API: POST /api/grants to create the grant
  // pending, then POST /api/grants/{id}/approve to approve it (which
  // enforces the approver-policy as fixed in PR #284).
  const rawAuthzDetails = String(query.authorization_details ?? '')
  if (rawAuthzDetails.trim() && parseAuthorizationDetails(rawAuthzDetails).length > 0) {
    throw createProblemError({
      status: 400,
      title: '`authorization_details` is not supported on /authorize',
      detail:
        'Use POST /api/grants to create the grant pending, then '
        + 'POST /api/grants/{id}/approve via the approver-policy. '
        + 'See https://github.com/openape-ai/openape/issues/273',
    })
  }
  const approvedDetails: OpenApeAuthorizationDetail[] | undefined = undefined

  const code = crypto.randomUUID()
  await codeStore.save({
    code,
    clientId: params.client_id,
    redirectUri: params.redirect_uri,
    codeChallenge: params.code_challenge,
    userId,
    nonce: params.nonce,
    expiresAt: Date.now() + 60_000,
    act: actorType,
    scope: params.scope || undefined,
    authorizationDetails: approvedDetails,
    delegationAct,
    delegationGrant: delegationGrantId,
  })

  const redirectUrl = new URL(params.redirect_uri)
  redirectUrl.searchParams.set('code', code)
  redirectUrl.searchParams.set('state', params.state)

  // Session cleanup only for human flow
  if (!bearerPayload) {
    const session = await getAppSession(event)
    await session.update({ pendingAuthorize: undefined, returnTo: undefined })
  }

  return sendRedirect(event, redirectUrl.toString())
})
