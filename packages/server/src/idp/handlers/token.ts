import type { H3Event } from 'h3'
import type { TokenExchangeParams } from '@openape/auth'
import { defineEventHandler, getRequestHeader, readRawBody, setResponseStatus } from 'h3'
import { handleRefreshGrant, handleTokenExchange, issueAssertion, validateClientAssertion } from '@openape/auth'
import { useGrant, validateDelegation } from '@openape/grants'
import type { IdPConfig, IdPStores } from '../config.js'
import { sshEd25519ToKeyObject } from '../utils/ed25519.js'
import { issueAuthToken } from '../utils/auth-token.js'

const RE_WHITESPACE = /\s+/

function oauthError(event: H3Event, status: number, error: string, description: string) {
  setResponseStatus(event, status)
  return { error, error_description: description }
}

function parseScope(scope?: string): Set<string> {
  if (!scope) return new Set()
  return new Set(scope.split(RE_WHITESPACE).filter(Boolean))
}

function resolveUserClaimsFactory(stores: IdPStores) {
  return async (userId: string, scope?: string) => {
    const scopes = parseScope(scope)
    const claims: { email?: string, name?: string } = {}

    const includeAll = scopes.size === 0
    const needsUser = includeAll || scopes.has('email') || scopes.has('profile')

    if (needsUser) {
      const user = await stores.userStore.findByEmail(userId)
      if (user) {
        if (includeAll || scopes.has('email')) {
          claims.email = user.email
        }
        if (includeAll || scopes.has('profile')) {
          claims.name = user.name
        }
      }
    }

    return claims
  }
}

export function createTokenHandler(stores: IdPStores, config: IdPConfig) {
  return defineEventHandler(async (event) => {
    const contentType = getRequestHeader(event, 'content-type') || ''
    const rawBody = await readRawBody(event, 'utf-8') || ''

    let body: Record<string, string>
    if (contentType.includes('application/x-www-form-urlencoded')) {
      body = Object.fromEntries(new URLSearchParams(rawBody))
    }
    else {
      try {
        body = JSON.parse(rawBody || '{}')
      }
      catch {
        return oauthError(event, 400, 'invalid_request', 'Malformed request body')
      }
    }

    const grantType = body.grant_type

    if (grantType === 'client_credentials') {
      return handleClientCredentialsGrant(event, body, stores, config)
    }

    if (grantType === 'refresh_token') {
      return handleRefreshTokenGrant(event, body, stores, config)
    }

    if (grantType === 'authorization_code') {
      return handleAuthorizationCodeGrant(event, body as unknown as TokenExchangeParams, stores, config)
    }

    return oauthError(event, 400, 'unsupported_grant_type', 'Grant type not supported')
  })
}

async function handleClientCredentialsGrant(
  event: H3Event,
  body: Record<string, string>,
  stores: IdPStores,
  config: IdPConfig,
) {
  const assertionType = body.client_assertion_type
  const assertion = body.client_assertion
  const delegationGrantParam = body.delegation_grant
  const audience = body.audience

  if (assertionType !== 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer') {
    return oauthError(event, 400, 'invalid_request', 'Unsupported client_assertion_type')
  }

  if (!assertion) {
    return oauthError(event, 400, 'invalid_request', 'Missing client_assertion')
  }

  try {
    const { sub } = await validateClientAssertion(
      assertion,
      `${config.issuer}/token`,
      async (userEmail) => {
        const user = await stores.userStore.findByEmail(userEmail)
        if (!user || !user.isActive) return null
        // Look up SSH key for this user
        const keys = await stores.sshKeyStore.findByUser(userEmail)
        if (keys.length === 0) return null
        return sshEd25519ToKeyObject(keys[0]!.publicKey)
      },
      stores.jtiStore,
    )

    // Delegation flow
    if (delegationGrantParam) {
      if (!audience) {
        return oauthError(event, 400, 'invalid_request', 'Missing audience for delegation')
      }

      const grant = await validateDelegation(delegationGrantParam, sub, audience, stores.grantStore)
      await useGrant(grant.id, stores.grantStore)

      const token = await issueAssertion(
        {
          sub: grant.request.delegator!,
          aud: audience,
          nonce: crypto.randomUUID(),
          delegation_act: { sub },
          delegation_grant: grant.id,
        },
        stores.keyStore,
        config.issuer,
      )

      return {
        access_token: token,
        token_type: 'Bearer',
        expires_in: 300,
      }
    }

    // Standard agent token
    const signingKey = await stores.keyStore.getSigningKey()
    const token = await issueAuthToken(
      { sub, act: 'agent' },
      config.issuer,
      signingKey.privateKey,
      signingKey.kid,
    )

    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: 3600,
    }
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Client credentials authentication failed'
    return oauthError(event, 401, 'invalid_client', message)
  }
}

async function handleRefreshTokenGrant(
  event: H3Event,
  body: Record<string, string>,
  stores: IdPStores,
  config: IdPConfig,
) {
  const refreshToken = body.refresh_token
  const clientId = body.client_id

  if (!refreshToken) {
    return oauthError(event, 400, 'invalid_request', 'Missing refresh_token')
  }

  if (!clientId) {
    return oauthError(event, 400, 'invalid_request', 'Missing client_id')
  }

  try {
    const result = await handleRefreshGrant(
      refreshToken,
      clientId,
      stores.refreshTokenStore,
      stores.keyStore,
      config.issuer,
      resolveUserClaimsFactory(stores),
    )
    return result
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Refresh token exchange failed'
    return oauthError(event, 400, 'invalid_grant', message)
  }
}

async function handleAuthorizationCodeGrant(
  event: H3Event,
  body: TokenExchangeParams,
  stores: IdPStores,
  config: IdPConfig,
) {
  if (!body.grant_type || !body.code || !body.code_verifier || !body.redirect_uri || !body.client_id) {
    return oauthError(event, 400, 'invalid_request', 'Missing required fields: grant_type, code, code_verifier, redirect_uri, client_id')
  }

  try {
    const result = await handleTokenExchange(
      body,
      stores.codeStore,
      stores.keyStore,
      config.issuer,
      resolveUserClaimsFactory(stores),
      stores.refreshTokenStore,
    )
    return result
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Token exchange failed'
    return oauthError(event, 400, 'invalid_grant', message)
  }
}
