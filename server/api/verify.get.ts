import { createError, defineEventHandler, getQuery, sendRedirect } from 'h3'
import { consumeMagicLinkToken } from '../utils/magic-link-store'
import { getAppSession } from '../utils/session'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const token = String(query.token ?? '')

  if (!token) {
    throw createError({ statusCode: 400, statusMessage: 'Missing token' })
  }

  // 1. Verify + consume token (one-time use)
  const email = await consumeMagicLinkToken(token)
  if (!email) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid or expired token' })
  }

  // 2. Get current session to preserve pendingAuthorize
  const oldSession = await getAppSession(event)
  const pendingAuthorize = oldSession.data.pendingAuthorize

  // 3. Session regeneration (prevent session fixation)
  await oldSession.clear()
  const newSession = await getAppSession(event)

  // 4. Set userId and restore pendingAuthorize
  await newSession.update({
    userId: email,
    pendingAuthorize,
  })

  // 5. Redirect back to /authorize if we have a pending request
  if (pendingAuthorize) {
    const params = new URLSearchParams()
    params.set('response_type', pendingAuthorize.response_type)
    params.set('sp_id', pendingAuthorize.sp_id)
    params.set('redirect_uri', pendingAuthorize.redirect_uri)
    params.set('state', pendingAuthorize.state)
    params.set('code_challenge', pendingAuthorize.code_challenge)
    params.set('code_challenge_method', pendingAuthorize.code_challenge_method)
    params.set('nonce', pendingAuthorize.nonce)
    return sendRedirect(event, `/authorize?${params.toString()}`)
  }

  // Fallback: redirect to landing page
  return sendRedirect(event, '/verify?success=true')
})
