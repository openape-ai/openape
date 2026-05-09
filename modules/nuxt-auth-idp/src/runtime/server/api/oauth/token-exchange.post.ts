// RFC 8693 OAuth 2.0 Token Exchange.
//
// Use case: a delegate (typically an agent like the local Nest) holds
// its own IdP-issued access token AND a Delegation grant from a
// delegator (typically the human user). It wants to act on behalf of
// the delegator at IdP-level — e.g. enroll a sub-agent so the new
// agent's owner is the human, not the delegate.
//
// Inputs (JSON or form):
//   subject_token     - access token of the delegator (Patrick)
//   actor_token       - access token of the delegate (Nest)
//   grant_type        - must equal urn:ietf:params:oauth:grant-type:token-exchange
//   audience?         - the audience the new token should carry (default: apes-cli)
//   delegation_grant_id? - explicit delegation grant. If omitted, we
//                          look up an active 'always'/'timed' delegation
//                          grant where delegator=subject and
//                          delegate=actor with audience that matches
//                          (or '*').
//
// Output: { access_token, token_type:'Bearer', expires_in:3600,
//           issued_token_type:'urn:ietf:params:oauth:token-type:access_token' }
//
// On success the new token has:
//   sub  = delegator email (i.e. the subject_token's sub)
//   act  = { sub: delegate email, type: 'agent' } per DDISA's RFC-8693
//          mapping — see DelegationActClaim in @openape/core/types.
// Downstream verifiers can read both pieces and decide owner-attribution
// without server-side heuristics.

import type { DelegationActClaim, OpenApeGrant } from '@openape/core'
import { defineEventHandler, readBody, setHeader } from 'h3'
import { SignJWT } from 'jose'
import { verifyAuthToken } from '../../utils/agent-token'
import { useGrantStores } from '../../utils/grant-stores'
import { createProblemError } from '../../utils/problem'
import { getIdpIssuer, useIdpStores } from '../../utils/stores'

const TOKEN_EXCHANGE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange'
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token'
const DEFAULT_AUDIENCE = 'apes-cli'

interface TokenExchangeBody {
  grant_type?: string
  subject_token?: string
  subject_token_type?: string
  actor_token?: string
  actor_token_type?: string
  audience?: string
  delegation_grant_id?: string
}

export default defineEventHandler(async (event) => {
  // OAuth endpoints are not session-protected — they verify presented
  // tokens. CORS-friendly + cache-control to prevent token reuse from
  // proxies.
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'Pragma', 'no-cache')

  const body = (await readBody<TokenExchangeBody>(event)) ?? {}

  if (body.grant_type !== TOKEN_EXCHANGE_GRANT_TYPE) {
    throw createProblemError({
      status: 400,
      title: `grant_type must be ${TOKEN_EXCHANGE_GRANT_TYPE} (got ${body.grant_type ?? 'undefined'})`,
    })
  }
  if (!body.subject_token) {
    throw createProblemError({ status: 400, title: 'subject_token is required' })
  }
  if (!body.actor_token) {
    throw createProblemError({ status: 400, title: 'actor_token is required (RFC 8693 § 2.1)' })
  }

  const { keyStore } = useIdpStores()
  const { grantStore } = useGrantStores()
  const issuer = getIdpIssuer()

  // Verify both presented tokens against the IdP's own JWKS (we only
  // accept tokens we issued ourselves — no external IdP federation
  // here). Audience is intentionally not asserted: the subject and
  // actor tokens may have been issued for different audiences (CLI vs
  // SP) and that's fine — the exchange minted token gets a fresh aud.
  const signingKey = await keyStore.getSigningKey()
  let subjectClaims, actorClaims
  try {
    subjectClaims = await verifyAuthToken(body.subject_token, issuer, signingKey.publicKey)
  }
  catch (err) {
    throw createProblemError({
      status: 401,
      title: `Invalid subject_token: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
  try {
    actorClaims = await verifyAuthToken(body.actor_token, issuer, signingKey.publicKey)
  }
  catch (err) {
    throw createProblemError({
      status: 401,
      title: `Invalid actor_token: ${err instanceof Error ? err.message : String(err)}`,
    })
  }

  if (actorClaims.act !== 'agent') {
    throw createProblemError({
      status: 400,
      title: 'actor_token must be an agent token (act=\'agent\')',
    })
  }

  const requestedAudience = body.audience ?? DEFAULT_AUDIENCE

  // Find the delegation grant. Either explicit grant_id or look up
  // the most-recent active 'always'/'timed' delegation grant where
  // delegator=subject AND delegate=actor AND audience matches (or '*').
  const delegation = body.delegation_grant_id
    ? await loadExplicitDelegation(grantStore, body.delegation_grant_id, subjectClaims.sub, actorClaims.sub, requestedAudience)
    : await loadFirstActiveDelegation(grantStore, subjectClaims.sub, actorClaims.sub, requestedAudience)

  if (!delegation) {
    throw createProblemError({
      status: 403,
      title: `No active delegation found from ${subjectClaims.sub} to ${actorClaims.sub} for audience ${requestedAudience}`,
    })
  }

  // Mint the delegated access token. `act` is structured per DDISA
  // (DelegationActClaim with sub) — downstream consumers narrow on
  // `claims.act && typeof claims.act === 'object' && 'sub' in claims.act`.
  const actClaim: DelegationActClaim = { sub: actorClaims.sub }
  const expiresInSec = 3600
  const access_token = await new SignJWT({
    act: actClaim,
    delegation_grant: delegation.id,
  })
    .setProtectedHeader({ alg: 'EdDSA', kid: signingKey.kid })
    .setIssuer(issuer)
    .setSubject(subjectClaims.sub)
    .setAudience(requestedAudience)
    .setIssuedAt()
    .setExpirationTime(`${expiresInSec}s`)
    .sign(signingKey.privateKey)

  return {
    access_token,
    token_type: 'Bearer',
    expires_in: expiresInSec,
    issued_token_type: ACCESS_TOKEN_TYPE,
  }
})

// --- helpers ---

async function loadExplicitDelegation(
  grantStore: ReturnType<typeof useGrantStores>['grantStore'],
  grantId: string,
  delegatorEmail: string,
  delegateEmail: string,
  audience: string,
): Promise<OpenApeGrant | null> {
  const grant = await grantStore.findById(grantId)
  if (!grant) return null
  if (grant.type !== 'delegation') return null
  if (grant.status !== 'approved') return null
  if (grant.request.delegator !== delegatorEmail) return null
  if (grant.request.delegate !== delegateEmail) return null
  if (grant.request.audience !== '*' && grant.request.audience !== audience) return null
  if (grant.expires_at && grant.expires_at <= Math.floor(Date.now() / 1000)) return null
  return grant
}

async function loadFirstActiveDelegation(
  grantStore: ReturnType<typeof useGrantStores>['grantStore'],
  delegatorEmail: string,
  delegateEmail: string,
  audience: string,
): Promise<OpenApeGrant | null> {
  // listGrants supports filtering by requester+status; delegations are
  // stored with requester=delegator. Pull the human's approved grants
  // and post-filter for delegation type + delegate match.
  const result = await grantStore.listGrants({
    requester: delegatorEmail,
    status: 'approved',
    limit: 200,
  })
  const now = Math.floor(Date.now() / 1000)
  for (const g of result.data) {
    if (g.type !== 'delegation') continue
    if (g.request.delegate !== delegateEmail) continue
    if (g.request.audience !== '*' && g.request.audience !== audience) continue
    if (g.expires_at && g.expires_at <= now) continue
    return g
  }
  return null
}
