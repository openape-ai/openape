// RFC 8693 Token Exchange — delegation flavour.
//
// Use case: a delegate (e.g. the local Nest agent) wants to act on
// behalf of a delegator (e.g. Patrick) at the IdP. Posts both tokens
// to `POST /api/oauth/token-exchange` and gets back a fresh access
// token whose `sub` is the delegator and whose `act` is the delegate.
//
// Distinct from `exchangeForSpToken`: that one trades an IdP token
// for an SP-scoped token (audience switch within the same identity).
// This one trades two tokens + a delegation grant for an identity-
// switched token (the delegate becomes "actor for delegator").

import { ofetch } from 'ofetch'
import { AuthError } from './types.js'

export interface DelegationExchangeRequest {
  /** IdP base URL (e.g. `https://id.openape.ai`). */
  idp: string
  /** The delegate's access token. REQUIRED — proves we're the actor. */
  actorToken: string
  /** Optional. The delegator's access token, when the caller has it.
   * If `delegationGrantId` is given, this is omitted — the IdP derives
   * the delegator from the grant. Useful for callers that hold both
   * tokens and want belt-and-suspenders verification. */
  subjectToken?: string
  /** RECOMMENDED. Explicit delegation grant id. When provided, the
   * IdP doesn't need a `subjectToken` — it derives the delegator
   * from grant.delegator. */
  delegationGrantId?: string
  /** Audience to request for the resulting token. Default: `apes-cli`. */
  audience?: string
}

export interface DelegationExchangeResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  issued_token_type: 'urn:ietf:params:oauth:token-type:access_token'
}

const TOKEN_EXCHANGE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange'
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token'

/**
 * Mint a delegation-bearing access token via RFC 8693.
 *
 * Throws AuthError(401) if either token is invalid/expired,
 * AuthError(403) if no matching delegation grant exists,
 * AuthError(400) on malformed input.
 */
export async function exchangeWithDelegation(
  req: DelegationExchangeRequest,
): Promise<DelegationExchangeResponse> {
  const url = `${req.idp.replace(/\/$/, '')}/api/oauth/token-exchange`
  try {
    return await ofetch<DelegationExchangeResponse>(url, {
      method: 'POST',
      body: {
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        actor_token: req.actorToken,
        actor_token_type: ACCESS_TOKEN_TYPE,
        ...(req.subjectToken ? { subject_token: req.subjectToken, subject_token_type: ACCESS_TOKEN_TYPE } : {}),
        ...(req.audience ? { audience: req.audience } : {}),
        ...(req.delegationGrantId ? { delegation_grant_id: req.delegationGrantId } : {}),
      },
    })
  }
  catch (err: unknown) {
    const status = (err as { status?: number, statusCode?: number }).status
      ?? (err as { statusCode?: number }).statusCode
      ?? 0
    const data = (err as { data?: { title?: string, detail?: string } }).data
    const title = data?.title ?? `Delegation token-exchange failed (HTTP ${status})`
    throw new AuthError(status, title, data?.detail)
  }
}
