import type { ActorType, DDISAAssertionClaims, DDISADelegateClaim, DelegationActClaim, OpenApeAuthorizationDetail } from '@openape/core'
import type { JWTPayload } from 'jose'
import type { CodeStore, KeyStore, RefreshTokenStore } from './stores.js'
import { generateCodeChallenge, signJWT } from '@openape/core'

const RE_WHITESPACE = /\s+/

export interface TokenExchangeParams {
  grant_type: string
  code: string
  code_verifier: string
  redirect_uri: string
  client_id: string
}

export interface TokenExchangeResult {
  id_token: string
  access_token: string
  token_type: string
  expires_in: number
  assertion: string
  refresh_token?: string
  authorization_details?: OpenApeAuthorizationDetail[]
}

export interface UserClaimsResolver {
  (userId: string, scope?: string): Promise<{ email?: string, name?: string }>
}

/**
 * Handle token exchange: validate code + PKCE, issue assertion.
 */
export async function handleTokenExchange(
  params: TokenExchangeParams,
  codeStore: CodeStore,
  keyStore: KeyStore,
  issuer: string,
  resolveUserClaims?: UserClaimsResolver,
  refreshTokenStore?: RefreshTokenStore,
): Promise<TokenExchangeResult> {
  // Validate grant_type
  if (params.grant_type !== 'authorization_code') {
    throw new Error('Unsupported grant_type')
  }

  // Find the code
  const codeEntry = await codeStore.find(params.code)
  if (!codeEntry) {
    throw new Error('Invalid or expired authorization code')
  }

  // Validate client ID
  if (codeEntry.clientId !== params.client_id) {
    throw new Error('Client ID mismatch')
  }

  // Validate redirect URI
  if (codeEntry.redirectUri !== params.redirect_uri) {
    throw new Error('Redirect URI mismatch')
  }

  // Validate PKCE
  const computedChallenge = await generateCodeChallenge(params.code_verifier)
  if (computedChallenge !== codeEntry.codeChallenge) {
    throw new Error('PKCE verification failed')
  }

  // Delete the code (single use)
  await codeStore.delete(params.code)

  // Resolve user claims based on scope
  let extraClaims: { email?: string, name?: string } = {}
  if (resolveUserClaims) {
    extraClaims = await resolveUserClaims(codeEntry.userId, codeEntry.scope)
  }

  // Issue assertion
  const assertion = await issueAssertion(
    {
      sub: codeEntry.userId,
      aud: params.client_id,
      nonce: codeEntry.nonce,
      act: codeEntry.act,
      delegate: codeEntry.delegate,
      email: extraClaims.email,
      name: extraClaims.name,
      authorization_details: codeEntry.authorizationDetails,
      delegation_act: codeEntry.delegationAct,
      delegation_grant: codeEntry.delegationGrant,
    },
    keyStore,
    issuer,
  )

  const result: TokenExchangeResult = {
    id_token: assertion,
    access_token: assertion,
    token_type: 'Bearer',
    expires_in: 300,
    assertion,
  }

  // Include authorization_details in token response
  if (codeEntry.authorizationDetails?.length) {
    result.authorization_details = codeEntry.authorizationDetails
  }

  // Generate refresh token if offline_access scope requested
  const scopes = new Set((codeEntry.scope ?? '').split(RE_WHITESPACE).filter(Boolean))
  if (scopes.has('offline_access') && refreshTokenStore) {
    const { token } = await refreshTokenStore.create(codeEntry.userId, params.client_id)
    result.refresh_token = token
  }

  return result
}

export interface AssertionClaimsInput {
  sub: string
  aud: string
  nonce?: string
  act?: ActorType
  delegate?: DDISADelegateClaim
  email?: string
  name?: string
  authorization_details?: OpenApeAuthorizationDetail[]
  /** RFC 8693 delegation: the actual actor */
  delegation_act?: DelegationActClaim
  /** Delegation grant ID */
  delegation_grant?: string
}

/**
 * Create and sign an assertion JWT.
 */
export async function issueAssertion(
  claims: AssertionClaimsInput,
  keyStore: KeyStore,
  issuer: string,
): Promise<string> {
  const key = await keyStore.getSigningKey()
  const now = Math.floor(Date.now() / 1000)

  const payload: DDISAAssertionClaims & { email?: string, name?: string, authorization_details?: OpenApeAuthorizationDetail[] } = {
    iss: issuer,
    sub: claims.sub,
    aud: claims.aud,
    act: claims.delegation_act ?? claims.act ?? 'human',
    iat: now,
    exp: now + 300, // 5 minutes max
    jti: crypto.randomUUID(),
    ...(claims.nonce ? { nonce: claims.nonce } : {}),
  }

  if (claims.delegation_grant) {
    payload.delegation_grant = claims.delegation_grant
  }

  if (claims.delegate) {
    payload.delegate = claims.delegate
  }

  if (claims.email) {
    payload.email = claims.email
  }

  if (claims.name) {
    payload.name = claims.name
  }

  if (claims.authorization_details?.length) {
    payload.authorization_details = claims.authorization_details
  }

  return signJWT(payload as unknown as JWTPayload, key.privateKey, { kid: key.kid })
}
