import type { EventHandler } from 'h3'
import { handleCallback } from '@openape/auth'
import { defineEventHandler, getQuery, getRequestURL, sendRedirect, useSession } from 'h3'
import type { SPConfig } from '../config.js'
import { clearFlowState, getFlowState, SESSION_SECRET } from './api-login.js'

const SP_SESSION_NAME = 'openape-sp'

export function createApiCallbackHandler(config: SPConfig): EventHandler {
  return defineEventHandler(async (event) => {
    const query = getQuery(event)
    const { code, state, error, error_description } = query as Record<string, string>
    const origin = getRequestURL(event).origin
    const redirectUri = `${origin}/api/callback`

    if (error) {
      const msg = error_description || error
      return sendRedirect(event, `/?error=${encodeURIComponent(msg)}`)
    }

    if (!code || !state) {
      return sendRedirect(event, `/?error=${encodeURIComponent('Invalid or expired state — please try again')}`)
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
        clientId: config.clientId,
        redirectUri,
      })

      await clearFlowState(event)

      // Store claims in session cookie
      const session = await useSession(event, {
        name: SP_SESSION_NAME,
        password: SESSION_SECRET,
      })
      await session.update({
        claims: result.claims,
        authorizationDetails: result.authorizationDetails,
      })

      return sendRedirect(event, '/dashboard')
    }
    catch (err: unknown) {
      await clearFlowState(event)
      const message = err instanceof Error ? err.message : 'Callback processing failed'
      return sendRedirect(event, `/?error=${encodeURIComponent(message)}`)
    }
  })
}

export { SP_SESSION_NAME }
