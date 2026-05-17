import type { KeyStore, RefreshTokenStore } from './stores.js'
import type { UserClaimsResolver } from './token.js'
import { issueAssertion } from './token.js'

export interface RefreshGrantResult {
  id_token: string
  access_token: string
  token_type: string
  expires_in: number
  refresh_token: string
  assertion: string
}

export class RefreshClientMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RefreshClientMismatchError'
  }
}

/**
 * Handle grant_type=refresh_token: rotate refresh token, issue new access/id tokens.
 *
 * The `clientId` arg is the request's `client_id` form field, which we
 * MUST verify matches the client the refresh token was originally
 * issued to (RFC 6749 §6). Without this check a refresh token captured
 * for SP-A could be presented at /token with `client_id=SP-B` to mint
 * a fresh assertion `aud=SP-B` — audience binding broken. See security
 * audit 2026-05-04 / GitHub issue #274.
 */
export async function handleRefreshGrant(
  refreshToken: string,
  clientId: string,
  refreshStore: RefreshTokenStore,
  keyStore: KeyStore,
  issuer: string,
  resolveUserClaims?: UserClaimsResolver,
): Promise<RefreshGrantResult> {
  const { newToken, userId, clientId: issuedClientId } = await refreshStore.consume(refreshToken)

  if (issuedClientId !== clientId) {
    throw new RefreshClientMismatchError(
      `Refresh token was issued for client_id=${issuedClientId}, cannot redeem for client_id=${clientId}`,
    )
  }

  // Resolve user claims (same as in authorization_code flow)
  let extraClaims: { email?: string, name?: string, approver?: string } = {}
  if (resolveUserClaims) {
    // Use offline_access scope to indicate refresh context
    extraClaims = await resolveUserClaims(userId, 'openid email profile')
  }

  const assertion = await issueAssertion(
    {
      sub: userId,
      aud: clientId,
      nonce: crypto.randomUUID(),
      email: extraClaims.email,
      name: extraClaims.name,
      approver: extraClaims.approver,
    },
    keyStore,
    issuer,
  )

  return {
    id_token: assertion,
    access_token: assertion,
    token_type: 'Bearer',
    expires_in: 300,
    refresh_token: newToken,
    assertion,
  }
}
