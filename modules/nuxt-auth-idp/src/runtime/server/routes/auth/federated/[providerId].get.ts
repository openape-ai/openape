import { defineEventHandler, getQuery, getRequestURL, getRouterParam, sendRedirect } from 'h3'
import { generateCodeChallenge, generateCodeVerifier } from '@openape/core'
import { fetchOidcDiscovery, findProvider, saveFederationState } from '../../../utils/federation'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  const providerId = getRouterParam(event, 'providerId')!
  const query = getQuery(event)
  const returnTo = String(query.returnTo ?? '')

  const provider = findProvider(providerId)
  if (!provider) {
    throw createProblemError({ status: 404, title: `Unknown federation provider: ${providerId}` })
  }

  const discovery = await fetchOidcDiscovery(provider.issuer)

  const state = crypto.randomUUID()
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)

  await saveFederationState(state, {
    providerId,
    codeVerifier,
    state,
    returnTo: returnTo || undefined,
    createdAt: Date.now(),
  })

  const scopes = provider.scopes ?? ['openid', 'email', 'profile']
  const origin = getRequestURL(event).origin
  const redirectUri = `${origin}/auth/federated/${providerId}/callback`

  const authUrl = new URL(discovery.authorization_endpoint)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', provider.clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', scopes.join(' '))
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  return sendRedirect(event, authUrl.toString())
})
