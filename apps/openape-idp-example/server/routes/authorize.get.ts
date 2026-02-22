import { validateAuthorizeRequest, evaluatePolicy } from '@ddisa/idp-server'
import type { AuthorizeParams } from '@ddisa/idp-server'
import { resolveDDISA, extractDomain } from '@ddisa/core'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const session = await getAppSession(event)
  const { codeStore } = useStores()

  const params: AuthorizeParams = {
    sp_id: String(query.sp_id ?? ''),
    redirect_uri: String(query.redirect_uri ?? ''),
    state: String(query.state ?? ''),
    code_challenge: String(query.code_challenge ?? ''),
    code_challenge_method: String(query.code_challenge_method ?? ''),
    nonce: String(query.nonce ?? ''),
    response_type: String(query.response_type ?? ''),
  }

  const error = validateAuthorizeRequest(params)
  if (error) {
    throw createError({ statusCode: 400, statusMessage: error })
  }

  // If user is not logged in, store params and redirect to login
  if (!session.data.userId) {
    const returnTo = `/authorize?${new URLSearchParams(query as Record<string, string>).toString()}`
    await session.update({ pendingAuthorize: params, returnTo })
    const loginUrl = new URL('/login', getRequestURL(event).origin)
    loginUrl.searchParams.set('returnTo', returnTo)
    const loginHint = String(query.login_hint ?? '')
    if (loginHint) {
      loginUrl.searchParams.set('login_hint', loginHint)
    }
    return sendRedirect(event, loginUrl.pathname + loginUrl.search)
  }

  // User is logged in — resolve policy mode from the user's domain DNS record
  const userDomain = extractDomain(session.data.userId)
  const ddisaRecord = await resolveDDISA(userDomain)
  const policyMode = ddisaRecord?.mode ?? 'open'
  const noopConsentStore = { hasConsent: async () => false, save: async () => {} }
  const decision = await evaluatePolicy(policyMode, params.sp_id, session.data.userId, noopConsentStore)

  if (decision !== 'allow') {
    const redirectUrl = new URL(params.redirect_uri)
    redirectUrl.searchParams.set('error', 'access_denied')
    redirectUrl.searchParams.set('state', params.state)
    return sendRedirect(event, redirectUrl.toString())
  }

  // Generate code and redirect
  const code = crypto.randomUUID()
  await codeStore.save({
    code,
    spId: params.sp_id,
    redirectUri: params.redirect_uri,
    codeChallenge: params.code_challenge,
    userId: session.data.userId,
    nonce: params.nonce,
    expiresAt: Date.now() + 60_000,
  })

  const redirectUrl = new URL(params.redirect_uri)
  redirectUrl.searchParams.set('code', code)
  redirectUrl.searchParams.set('state', params.state)

  await session.update({ pendingAuthorize: undefined, returnTo: undefined })

  return sendRedirect(event, redirectUrl.toString())
})
