import type { AuthorizeParams } from '@openape/auth'
import { createError, defineEventHandler, getQuery, getRequestURL, sendRedirect } from 'h3'
import { validateAuthorizeRequest } from '@openape/auth'
import { getAppSession } from '../utils/session'
import { useIdpStores } from '../utils/stores'
import { validateRedirectUri } from '../utils/sp-manifest'
import { generateCsrfToken } from '../utils/csrf'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const session = await getAppSession(event)
  const { codeStore } = useIdpStores()

  const params: AuthorizeParams = {
    sp_id: String(query.sp_id ?? ''),
    redirect_uri: String(query.redirect_uri ?? ''),
    state: String(query.state ?? ''),
    code_challenge: String(query.code_challenge ?? ''),
    code_challenge_method: String(query.code_challenge_method ?? ''),
    nonce: String(query.nonce ?? ''),
    response_type: String(query.response_type ?? ''),
  }

  // 1. Validate params
  const error = validateAuthorizeRequest(params)
  if (error) {
    throw createError({ statusCode: 400, statusMessage: error })
  }

  // 2. Validate redirect_uri against SP manifest
  await validateRedirectUri(params.sp_id, params.redirect_uri)

  // 3. Check if user is authenticated
  if (!session.data.userId) {
    // Generate CSRF token and store pending authorize
    const csrfToken = generateCsrfToken()
    const loginHint = String(query.login_hint ?? '')

    await session.update({
      pendingAuthorize: params,
      csrfToken,
      loginHint: loginHint || undefined,
    })

    const loginUrl = new URL('/login', getRequestURL(event).origin)
    if (loginHint) {
      loginUrl.searchParams.set('login_hint', loginHint)
    }
    return sendRedirect(event, loginUrl.pathname + loginUrl.search)
  }

  // 4. User is authenticated → generate code and redirect to SP
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

  // Clear pending authorize
  await session.update({ pendingAuthorize: undefined, csrfToken: undefined, loginHint: undefined })

  return sendRedirect(event, redirectUrl.toString())
})
