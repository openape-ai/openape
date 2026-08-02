// RFC 8693 Token Exchange — delegation flavour.
//
// Use case: a delegate (e.g. the local Nest agent) wants to act on
// behalf of a delegator (e.g. Patrick) at the IdP. Posts an Ed25519
// client assertion to `POST /token` and gets back a fresh access
// token whose `sub` is the delegator and whose `act` is the delegate.
//
// Distinct from `exchangeForSpToken`: that one trades an IdP token
// for an SP-scoped token (audience switch within the same identity).
// This one trades two tokens + a delegation grant for an identity-
// switched token (the delegate becomes "actor for delegator").

import { randomUUID, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { ofetch } from 'ofetch'
import { AuthError } from './types.js'
import { loadEd25519PrivateKey } from './ssh-key.js'

export interface DelegationExchangeRequest {
  /** IdP base URL (e.g. `https://id.openape.ai`). */
  idp: string
  /** The delegate's access token. Kept for API compatibility and diagnostics. */
  actorToken: string
  /** Email of the delegate signing the client assertion. */
  clientEmail: string
  /** Path to the delegate's Ed25519 private key. */
  clientKeyPath: string
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

const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'

function createClientAssertion(idp: string, email: string, keyPath: string): string {
  const now = Math.floor(Date.now() / 1000)
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = encode({ alg: 'EdDSA', typ: 'JWT' })
  const payload = encode({
    iss: email,
    sub: email,
    aud: `${idp.replace(/\/$/, '')}/token`,
    jti: randomUUID(),
    iat: now,
    exp: now + 300,
  })
  const signingInput = `${header}.${payload}`
  const key = loadEd25519PrivateKey(readFileSync(keyPath, 'utf8'))
  return `${signingInput}.${sign(null, Buffer.from(signingInput), key).toString('base64url')}`
}

/**
 * Mint a delegation-bearing access token via the IdP's client-credentials
 * endpoint. The assertion is deliberately short-lived and signed by the
 * delegate's registered Ed25519 key.
 *
 * Throws AuthError(401) if either token is invalid/expired,
 * AuthError(403) if no matching delegation grant exists,
 * AuthError(400) on malformed input.
 */
export async function exchangeWithDelegation(
  req: DelegationExchangeRequest,
): Promise<DelegationExchangeResponse> {
  const idp = req.idp.replace(/\/$/, '')
  const url = `${idp}/token`
  try {
    const clientAssertion = createClientAssertion(idp, req.clientEmail, req.clientKeyPath)
    return await ofetch<DelegationExchangeResponse>(url, {
      method: 'POST',
      body: {
        grant_type: 'client_credentials',
        client_assertion_type: CLIENT_ASSERTION_TYPE,
        client_assertion: clientAssertion,
        ...(req.audience ? { audience: req.audience } : {}),
        ...(req.delegationGrantId ? { delegation_grant: req.delegationGrantId } : {}),
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
