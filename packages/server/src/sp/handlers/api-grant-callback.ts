import type { EventHandler } from 'h3'
import { defineEventHandler, getQuery, sendRedirect, useSession } from 'h3'
import { SESSION_SECRET } from './api-login.js'
import { SP_SESSION_NAME } from './api-callback.js'

export function createApiGrantCallbackHandler(): EventHandler {
  return defineEventHandler(async (event) => {
    const query = getQuery(event)
    const { grant_id, authz_jwt, status } = query as Record<string, string>

    if (status === 'denied') {
      return sendRedirect(event, '/dashboard?grant_status=denied')
    }

    if (!authz_jwt || !grant_id) {
      return sendRedirect(event, '/dashboard?grant_status=error')
    }

    // Store the AuthZ-JWT in session
    const session = await useSession(event, {
      name: SP_SESSION_NAME,
      password: SESSION_SECRET,
    })
    await session.update({
      authzJWT: authz_jwt,
      grantId: grant_id,
    })

    return sendRedirect(event, '/dashboard?grant_status=approved')
  })
}
