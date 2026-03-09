import type { TokenExchangeParams } from '@openape/auth'
import { createError, defineEventHandler, readRawBody } from 'h3'
import { handleTokenExchange, validateClientAssertion } from '@openape/auth'
import { sshEd25519ToKeyObject } from '../utils/ed25519'
import { issueAgentToken } from '../utils/agent-token'
import { getIdpIssuer, useIdpStores } from '../utils/stores'

function parseScope(scope?: string): Set<string> {
  if (!scope) return new Set()
  return new Set(scope.split(/\s+/).filter(Boolean))
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

  return handleAuthorizationCodeGrant(body as unknown as TokenExchangeParams)
})

async function handleClientCredentialsGrant(body: Record<string, string>) {
  const assertionType = body.client_assertion_type
  const assertion = body.client_assertion

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

async function handleAuthorizationCodeGrant(body: TokenExchangeParams) {
  const { codeStore, keyStore, userStore } = useIdpStores()

  if (!body.grant_type || !body.code || !body.code_verifier || !body.redirect_uri || !body.sp_id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields: grant_type, code, code_verifier, redirect_uri, sp_id',
    })
  }

  try {
    const result = await handleTokenExchange(body, codeStore, keyStore, getIdpIssuer(), async (userId, scope) => {
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
    })
    return result
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Token exchange failed'
    throw createError({ statusCode: 400, statusMessage: message })
  }
}
