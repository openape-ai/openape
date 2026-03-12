import type { AuthFlowState } from '@openape/core'
import type { IdPConfig } from './discovery.js'
import {

  generateCodeChallenge,
  generateCodeVerifier,
  generateNonce,
  generateState,
} from '@openape/core'

export interface CreateAuthURLOptions {
  clientId: string
  redirectUri: string
  email?: string
}

export interface AuthURLResult {
  url: string
  flowState: AuthFlowState
}

/**
 * Build an authorization URL for the IdP redirect.
 */
export async function createAuthorizationURL(
  idpConfig: IdPConfig,
  options: CreateAuthURLOptions,
): Promise<AuthURLResult> {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)
  const state = generateState()
  const nonce = generateNonce()

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    nonce,
  })

  if (options.email) {
    params.set('login_hint', options.email)
  }

  const url = `${idpConfig.idpUrl}/authorize?${params.toString()}`

  return {
    url,
    flowState: {
      codeVerifier,
      state,
      nonce,
      idpUrl: idpConfig.idpUrl,
      createdAt: Date.now(),
    },
  }
}
