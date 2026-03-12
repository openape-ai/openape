import type { AuthFlowState, DDISAAssertionClaims, OpenApeAuthorizationDetail } from '@openape/core'
import type { KeyLike } from 'jose'
import { validateAssertion, WELL_KNOWN_JWKS } from '@openape/core'

export interface HandleCallbackOptions {
  /** The authorization code from the callback */
  code: string
  /** The state parameter from the callback */
  state: string
  /** The stored flow state from the authorization request */
  flowState: AuthFlowState
  /** The SP ID */
  clientId: string
  /** The redirect URI (must match the one used in the auth request) */
  redirectUri: string
  /** Public key for assertion verification (alternative to JWKS) */
  publicKey?: KeyLike | Uint8Array
}

export interface CallbackResult {
  claims: DDISAAssertionClaims
  rawAssertion: string
  authorizationDetails?: OpenApeAuthorizationDetail[]
}

/**
 * Handle the callback from the IdP: exchange code, validate assertion.
 */
export async function handleCallback(options: HandleCallbackOptions): Promise<CallbackResult> {
  const { code, state, flowState, clientId, redirectUri, publicKey } = options

  // 1. Validate state (CSRF protection)
  if (state !== flowState.state) {
    throw new Error('State mismatch — possible CSRF attack')
  }

  // 2. Exchange code for assertion via backchannel
  const tokenUrl = `${flowState.idpUrl}/token`
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      code_verifier: flowState.codeVerifier,
      redirect_uri: redirectUri,
      client_id: clientId,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Token exchange failed: ${response.status} ${body}`)
  }

  const data = await response.json() as { assertion: string, authorization_details?: OpenApeAuthorizationDetail[] }
  const rawAssertion = data.assertion

  // 3. Validate the assertion
  const jwksUri = `${flowState.idpUrl}${WELL_KNOWN_JWKS}`
  const result = await validateAssertion(rawAssertion, {
    expectedIss: flowState.idpUrl,
    expectedAud: clientId,
    jwksUri: publicKey ? undefined : jwksUri,
    publicKey,
    expectedNonce: flowState.nonce,
  })

  if (!result.valid || !result.claims) {
    throw new Error(`Assertion validation failed: ${result.error}`)
  }

  return {
    claims: result.claims,
    rawAssertion,
    authorizationDetails: data.authorization_details,
  }
}
