import type { JtiStore, KeyStore } from '@openape/auth'
import type { OpenApeGrant } from '@openape/core'
import type { GrantStore } from '@openape/grants'
import { generateCodeChallenge, signJWT, verifyJWT } from '@openape/core'

// Cross-SP delegation authorization code.
//
// The redirect/code variant of the cross-SP spawn flow (supersedes the
// browser-fetch + IdP-CORS path). The Receiver SP (e.g. org.openape.ai)
// drives the Owner through a top-level redirect to the IdP; the IdP issues
// a short-lived **signed authorization code** and redirects back; the SP's
// *server* redeems it server-to-server for the delegation AuthZ-JWT. No
// browser cross-origin call, so no CORS / no sameSite=none.
//
// The code is a signed JWT (not a stored opaque token): self-contained,
// tamper-evident, PKCE-bound, single-use via the existing jtiStore. This
// keeps the OIDC /authorize + /token login path completely untouched and
// needs no new persistence/migration.

const CODE_PURPOSE = 'openape:cross-sp-delegation-code'
const CODE_TTL_SEC = 60

export interface CrossSpCodeClaims {
  purpose: typeof CODE_PURPOSE
  /** The approved standing delegation grant this code authorizes against. */
  grant_id: string
  /** Owner (delegator) — must own the grant. */
  sub: string
  /** Delegate SP that requested the code (its client_id / host). */
  client_id: string
  /** Where the code was issued to — must match on redemption. */
  redirect_uri: string
  /** PKCE S256 challenge — redeemer proves possession of the verifier. */
  code_challenge: string
  jti: string
  iat: number
  exp: number
}

/**
 * Mint a single-use, PKCE-bound delegation authorization code (signed JWT).
 * Short TTL — it only has to survive the redirect back to the SP server.
 */
export async function mintCrossSpCode(
  input: { grantId: string, sub: string, clientId: string, redirectUri: string, codeChallenge: string },
  keyStore: KeyStore,
): Promise<string> {
  const key = await keyStore.getSigningKey()
  const now = Math.floor(Date.now() / 1000)
  const payload: CrossSpCodeClaims = {
    purpose: CODE_PURPOSE,
    grant_id: input.grantId,
    sub: input.sub,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + CODE_TTL_SEC,
  }
  return signJWT(payload as unknown as Record<string, unknown>, key.privateKey, { kid: key.kid })
}

export type VerifyCrossSpCodeResult
  = | { ok: true, claims: CrossSpCodeClaims }
    | { ok: false, reason: string }

/**
 * Verify a delegation code on redemption: signature + purpose + expiry,
 * exact client_id / redirect_uri match, PKCE (S256) against the supplied
 * verifier, and single-use via jtiStore. Never throws — returns a reason.
 */
export async function verifyCrossSpCode(
  code: string,
  input: { codeVerifier: string, clientId: string, redirectUri: string },
  keyStore: KeyStore,
  jtiStore: JtiStore,
): Promise<VerifyCrossSpCodeResult> {
  const key = await keyStore.getSigningKey()
  let claims: CrossSpCodeClaims
  try {
    const { payload } = await verifyJWT<CrossSpCodeClaims>(code, key.publicKey)
    claims = payload
  }
  catch (err) {
    return { ok: false, reason: `invalid code: ${err instanceof Error ? err.message : String(err)}` }
  }

  if (claims.purpose !== CODE_PURPOSE) return { ok: false, reason: 'wrong code purpose' }
  if (claims.client_id !== input.clientId) return { ok: false, reason: 'client_id mismatch' }
  if (claims.redirect_uri !== input.redirectUri) return { ok: false, reason: 'redirect_uri mismatch' }

  const challenge = await generateCodeChallenge(input.codeVerifier)
  if (challenge !== claims.code_challenge) return { ok: false, reason: 'PKCE verification failed' }

  // Single-use: the jti is reserved for the code's full lifetime so a
  // replay within the TTL window is rejected.
  if (await jtiStore.hasBeenUsed(claims.jti)) return { ok: false, reason: 'code already redeemed' }
  await jtiStore.markUsed(claims.jti, CODE_TTL_SEC * 1000)

  return { ok: true, claims }
}

/**
 * Server-side equivalent of the SP's old browser `findStandingGrant`:
 * the Owner's approved, `always`-type delegation to `delegate` for
 * `audienceHost` covering `scope`.
 */
export async function findStandingCrossSpGrant(
  grantStore: GrantStore,
  input: { owner: string, delegate: string, audienceHost: string, scope: string },
): Promise<OpenApeGrant | null> {
  const grants = await grantStore.findByRequester(input.owner)
  return grants.find(g =>
    g.status === 'approved'
    && g.request.grant_type === 'always'
    && g.request.delegate === input.delegate
    && g.request.audience === input.audienceHost
    && (g.request.scopes ?? []).includes(input.scope),
  ) ?? null
}
