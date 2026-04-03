import type { EventHandler } from 'h3'
import { defineEventHandler, useSession } from 'h3'
import { SESSION_SECRET } from './api-login.js'
import { SP_SESSION_NAME } from './api-callback.js'

export function createApiGrantStatusHandler(): EventHandler {
  return defineEventHandler(async (event) => {
    const session = await useSession(event, {
      name: SP_SESSION_NAME,
      password: SESSION_SECRET,
    })
    const data = session.data as Record<string, unknown>
    return {
      hasAuthzJWT: !!data.authzJWT,
    }
  })
}
