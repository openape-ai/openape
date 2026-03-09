import { defineEventHandler, getQuery, getRequestURL, sendRedirect } from 'h3'
import { handleCallback } from '@openape/auth'
import { getSpConfig, getFlowState, clearFlowState } from '../utils/sp-config'
import { getSpSession } from '../utils/sp-session'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const { code, state, error, error_description } = query as Record<string, string>
  const { spId } = getSpConfig()
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
      spId,
      redirectUri,
    })

    clearFlowState(event)

    const session = await getSpSession(event)
    await session.update({
      claims: result.claims,
      authorizationDetails: result.authorizationDetails,
    })

    return sendRedirect(event, '/dashboard')
  }
  catch (err: unknown) {
    clearFlowState(event)
    const message = err instanceof Error ? err.message : 'Callback processing failed'
    return sendRedirect(event, `/?error=${encodeURIComponent(message)}`)
  }
})
