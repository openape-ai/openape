// Canonical: @openape/server createTokenHandler
import type { H3Event } from 'h3'
import type { TokenExchangeParams } from '@openape/auth'
import { defineEventHandler, getRequestHeader, readRawBody, setResponseStatus } from 'h3'
import { handleRefreshGrant, handleTokenExchange, issueAssertion, validateClientAssertion } from '@openape/auth'
import { useGrant, validateDelegation } from '@openape/grants'
import { sshEd25519ToKeyObject } from '../utils/ed25519'
import { issueAgentToken } from '../utils/agent-token'
import { getIdpIssuer, useIdpStores } from '../utils/stores'
import { useGrantStores } from '../utils/grant-stores'

const RE_WHITESPACE = /\s+/

function oauthError(event: H3Event, status: number, error: string, description: string) {
  setResponseStatus(event, status)
  return { error, error_description: description }
}

function parseScope(scope?: string): Set<string> {
  if (!scope) return new Set()
  return new Set(scope.split(RE_WHITESPACE).filter(Boolean))
}

function resolveUserClaimsFactory() {
  const { userStore } = useIdpStores()
  return async (userId: string, scope?: string) => {
    const scopes = parseScope(scope)
    const claims: { email?: string, name?: string, approver?: string } = {}

    const includeAll = scopes.size === 0
    const needsUser = includeAll || scopes.has('email') || scopes.has('profile')

    if (needsUser) {
      const user = await userStore.findByEmail(userId)
      if (user) {
        if (includeAll || scopes.has('email')) {
          claims.email = user.email
        }
        if (includeAll || scopes.has('profile')) {
          claims.name = user.name
        }
        // Always surface approver when known so SPs (preview.openape.ai and
        // future tools) can route push notifications and grant approvals
        // without a server-to-server callback to the IdP. Undefined means
        // the user has no separate approver (acts as their own).
        if (user.approver) {
          claims.approver = user.approver
        }
      }
    }

    return claims
  }
}

export default defineEventHandler(async (event) => {
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
    return handleClientCredentialsGrant(event, body)
  }

  if (grantType === 'refresh_token') {
    return handleRefreshTokenGrant(event, body)
  }

  if (grantType === 'authorization_code') {
    return handleAuthorizationCodeGrant(event, body as unknown as TokenExchangeParams)
  }

  return oauthError(event, 400, 'unsupported_grant_type', 'Grant type not supported')
})

async function handleClientCredentialsGrant(event: H3Event, body: Record<string, string>) {
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

  const { userStore, sshKeyStore, keyStore, jtiStore } = useIdpStores()
  const issuer = getIdpIssuer()

  try {
    const { sub } = await validateClientAssertion(
      assertion,
      `${issuer}/token`,
      async (userEmail) => {
        const user = await userStore.findByEmail(userEmail)
        if (!user || !user.isActive) return null
        const keys = await sshKeyStore.findByUser(userEmail)
        if (keys.length === 0) return null
        return sshEd25519ToKeyObject(keys[0]!.publicKey)
      },
      jtiStore,
    )

    // Delegation flow: agent acts as delegator
    if (delegationGrantParam) {
      if (!audience) {
        return oauthError(event, 400, 'invalid_request', 'Missing audience for delegation')
      }

      const { grantStore } = useGrantStores()
      const grant = await validateDelegation(delegationGrantParam, sub, audience, grantStore)
      await useGrant(grant.id, grantStore)

      const token = await issueAssertion(
        {
          sub: grant.request.delegator!,
          aud: audience,
          nonce: crypto.randomUUID(),
          delegation_act: { sub },
          delegation_grant: grant.id,
        },
        keyStore,
        issuer,
      )

      return {
        access_token: token,
        token_type: 'Bearer',
        expires_in: 300,
      }
    }

    // Standard agent token
    const signingKey = await keyStore.getSigningKey()
    const token = await issueAgentToken(
      { sub },
      issuer,
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

async function handleRefreshTokenGrant(event: H3Event, body: Record<string, string>) {
  const refreshToken = body.refresh_token
  const clientId = body.client_id

  if (!refreshToken) {
    return oauthError(event, 400, 'invalid_request', 'Missing refresh_token')
  }

  if (!clientId) {
    return oauthError(event, 400, 'invalid_request', 'Missing client_id')
  }

  const { keyStore, refreshTokenStore } = useIdpStores()
  const issuer = getIdpIssuer()

  try {
    const result = await handleRefreshGrant(
      refreshToken,
      clientId,
      refreshTokenStore,
      keyStore,
      issuer,
      resolveUserClaimsFactory(),
    )
    return result
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Refresh token exchange failed'
    return oauthError(event, 400, 'invalid_grant', message)
  }
}

async function handleAuthorizationCodeGrant(event: H3Event, body: TokenExchangeParams) {
  const { codeStore, keyStore, refreshTokenStore } = useIdpStores()

  if (!body.grant_type || !body.code || !body.code_verifier || !body.redirect_uri || !body.client_id) {
    return oauthError(event, 400, 'invalid_request', 'Missing required fields: grant_type, code, code_verifier, redirect_uri, client_id')
  }

  try {
    const result = await handleTokenExchange(
      body,
      codeStore,
      keyStore,
      getIdpIssuer(),
      resolveUserClaimsFactory(),
      refreshTokenStore,
    )
    return result
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Token exchange failed'
    return oauthError(event, 400, 'invalid_grant', message)
  }
}
