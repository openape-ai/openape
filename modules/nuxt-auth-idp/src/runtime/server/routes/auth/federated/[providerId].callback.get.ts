import { defineEventHandler, getQuery, getRequestURL, getRouterParam, sendRedirect } from 'h3'
import { decodeJwt } from 'jose'
import {
  consumeFederationState,
  exchangeCodeForTokens,
  fetchOidcDiscovery,
  fetchUserInfo,
  findProvider,
} from '../../../utils/federation'
import { getAppSession } from '../../../utils/session'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  const providerId = getRouterParam(event, 'providerId')!
  const query = getQuery(event)

  const code = String(query.code ?? '')
  const state = String(query.state ?? '')
  const error = String(query.error ?? '')

  if (error) {
    const desc = String(query.error_description ?? error)
    return sendRedirect(event, `/login?error=${encodeURIComponent(desc)}`)
  }

  if (!code || !state) {
    return sendRedirect(event, `/login?error=${encodeURIComponent('Missing code or state from provider')}`)
  }

  const flowState = await consumeFederationState(state)
  if (!flowState) {
    return sendRedirect(event, `/login?error=${encodeURIComponent('Invalid or expired federation state')}`)
  }

  if (flowState.providerId !== providerId) {
    return sendRedirect(event, `/login?error=${encodeURIComponent('Provider mismatch')}`)
  }

  // Check state age (max 10 minutes)
  if (Date.now() - flowState.createdAt > 600_000) {
    return sendRedirect(event, `/login?error=${encodeURIComponent('Federation flow expired')}`)
  }

  const provider = findProvider(providerId)
  if (!provider) {
    throw createProblemError({ status: 404, title: `Unknown federation provider: ${providerId}` })
  }

  try {
    const discovery = await fetchOidcDiscovery(provider.issuer)
    const origin = getRequestURL(event).origin
    const redirectUri = `${origin}/auth/federated/${providerId}/callback`

    const tokens = await exchangeCodeForTokens(
      provider,
      discovery.token_endpoint,
      code,
      redirectUri,
      flowState.codeVerifier,
    )

    // Extract email from id_token or userinfo
    let email: string | undefined

    if (tokens.id_token) {
      const claims = decodeJwt(tokens.id_token)
      email = claims.email as string | undefined
    }

    if (!email && discovery.userinfo_endpoint) {
      const userinfo = await fetchUserInfo(discovery.userinfo_endpoint, tokens.access_token)
      email = userinfo.email
    }

    if (!email) {
      return sendRedirect(event, `/login?error=${encodeURIComponent('No email received from provider. Check scopes.')}`)
    }

    // Email-match: user must already exist
    const { userStore } = useIdpStores()
    const user = await userStore.findByEmail(email)

    if (!user) {
      return sendRedirect(event, `/login?error=${encodeURIComponent(`No account for ${email}. Wrong ${provider.id} account?`)}`)
    }

    // Create session (same as WebAuthn login)
    const session = await getAppSession(event)
    await session.update({ userId: user.email, userName: user.name })

    // Check if there was a pending authorize flow
    if (session.data.pendingAuthorize && session.data.returnTo) {
      const returnTo = session.data.returnTo as string
      return sendRedirect(event, returnTo)
    }

    // Redirect to returnTo from federation start or home
    const returnTo = flowState.returnTo || '/'
    return sendRedirect(event, returnTo)
  }
  catch (err) {
    const message = err instanceof Error ? err.message : 'Federation callback failed'
    return sendRedirect(event, `/login?error=${encodeURIComponent(message)}`)
  }
})
