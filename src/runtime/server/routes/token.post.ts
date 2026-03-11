import type { TokenExchangeParams } from '@openape/auth'
import { createError, defineEventHandler, readRawBody } from 'h3'
import { handleRefreshGrant, handleTokenExchange, issueAssertion, validateClientAssertion } from '@openape/auth'
import { useGrant, validateDelegation } from '@openape/grants'
import { sshEd25519ToKeyObject } from '../utils/ed25519'
import { issueAgentToken } from '../utils/agent-token'
import { getIdpIssuer, useIdpStores } from '../utils/stores'
import { useGrantStores } from '../utils/grant-stores'

const RE_WHITESPACE = /\s+/

function parseScope(scope?: string): Set<string> {
  if (!scope) return new Set()
  return new Set(scope.split(RE_WHITESPACE).filter(Boolean))
}

function resolveUserClaimsFactory() {
  const { userStore } = useIdpStores()
  return async (userId: string, scope?: string) => {
    const scopes = parseScope(scope)
    const claims: { email?: string, name?: string } = {}

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
      }
    }

    return claims
  }
}

export default defineEventHandler(async (event) => {
  const rawBody = await readRawBody(event, 'utf-8')
  let body: Record<string, string>
  try {
    body = JSON.parse(rawBody || '{}')
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' })
  }

  const grantType = body.grant_type

  if (grantType === 'client_credentials') {
    return handleClientCredentialsGrant(body)
  }

  if (grantType === 'refresh_token') {
    return handleRefreshTokenGrant(body)
  }

  return handleAuthorizationCodeGrant(body as unknown as TokenExchangeParams)
})

async function handleClientCredentialsGrant(body: Record<string, string>) {
  const assertionType = body.client_assertion_type
  const assertion = body.client_assertion
  const delegationGrantParam = body.delegation_grant
  const audience = body.audience

  if (assertionType !== 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer') {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported client_assertion_type' })
  }

  if (!assertion) {
    throw createError({ statusCode: 400, statusMessage: 'Missing client_assertion' })
  }

  const { agentStore, keyStore, jtiStore } = useIdpStores()
  const issuer = getIdpIssuer()

  try {
    const { sub } = await validateClientAssertion(
      assertion,
      `${issuer}/token`,
      async (agentEmail) => {
        const agent = await agentStore.findByEmail(agentEmail)
        if (!agent || !agent.isActive) return null
        return sshEd25519ToKeyObject(agent.publicKey)
      },
      jtiStore,
    )

    // Delegation flow: agent acts as delegator
    if (delegationGrantParam) {
      if (!audience) {
        throw createError({ statusCode: 400, statusMessage: 'Missing audience for delegation' })
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
    throw createError({ statusCode: 401, statusMessage: message })
  }
}

async function handleRefreshTokenGrant(body: Record<string, string>) {
  const refreshToken = body.refresh_token
  const clientId = body.client_id

  if (!refreshToken) {
    throw createError({ statusCode: 400, statusMessage: 'Missing refresh_token' })
  }

  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing client_id' })
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
    throw createError({ statusCode: 401, statusMessage: message })
  }
}

async function handleAuthorizationCodeGrant(body: TokenExchangeParams) {
  const { codeStore, keyStore, refreshTokenStore } = useIdpStores()

  if (!body.grant_type || !body.code || !body.code_verifier || !body.redirect_uri || !body.client_id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields: grant_type, code, code_verifier, redirect_uri, client_id',
    })
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
    throw createError({ statusCode: 400, statusMessage: message })
  }
}
