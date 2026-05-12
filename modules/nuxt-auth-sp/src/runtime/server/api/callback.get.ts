import { defineEventHandler, getQuery, getRequestURL, sendRedirect } from 'h3'
import { handleCallback } from '@openape/auth'
import { getSpConfig, getFlowState, clearFlowState } from '../utils/sp-config'
import { getSpSession } from '../utils/sp-session'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const { code, state, error, error_description } = query as Record<string, string>
  const { clientId } = getSpConfig()
  const origin = getRequestURL(event).origin
  const redirectUri = `${origin}/api/callback`

  if (error) {
    const msg = error_description || error
    return sendRedirect(event, `/?error=${encodeURIComponent(msg)}`)
  }

  if (!code || !state) {
    return sendRedirect(event, `/?error=${encodeURIComponent('Missing code or state parameter')}`)
  }

  const flowState = await getFlowState(event, state)
  if (!flowState) {
    return sendRedirect(event, `/?error=${encodeURIComponent('Invalid or expired state — please try again')}`)
  }

  try {
    const result = await handleCallback({
      code,
      state,
      flowState,
      clientId,
      redirectUri,
    })

    clearFlowState(event)

    const session = await getSpSession(event)
    await session.update({
      claims: result.claims,
      authorizationDetails: result.authorizationDetails,
    })

    // Where to land after a successful login. SPs override via the
    // `openapeSp.postLoginRedirect` module option (default `/dashboard`
    // for back-compat). Keeping a single source of truth here so
    // `OpenApeAuth.vue`'s already-logged-in fast-path and the callback
    // exit agree on the destination.
    const { postLoginRedirect } = getSpConfig()
    return sendRedirect(event, postLoginRedirect || '/dashboard')
  }
  catch (err: unknown) {
    clearFlowState(event)
    const message = err instanceof Error ? err.message : 'Callback processing failed'
    return sendRedirect(event, `/?error=${encodeURIComponent(message)}`)
  }
})
