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

/**
 * Handle grant_type=refresh_token: rotate refresh token, issue new access/id tokens.
 */
export async function handleRefreshGrant(
  refreshToken: string,
  clientId: string,
  refreshStore: RefreshTokenStore,
  keyStore: KeyStore,
  issuer: string,
  resolveUserClaims?: UserClaimsResolver,
): Promise<RefreshGrantResult> {
  const { newToken, userId } = await refreshStore.consume(refreshToken)

  // Resolve user claims (same as in authorization_code flow)
  let extraClaims: { email?: string, name?: string } = {}
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
