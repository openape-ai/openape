import type { EventHandler } from 'h3'
import { createError, defineEventHandler, useSession } from 'h3'
import { SESSION_SECRET } from './api-login.js'
import { SP_SESSION_NAME } from './api-callback.js'

export function createApiMeHandler(): EventHandler {
  return defineEventHandler(async (event) => {
    const session = await useSession(event, {
      name: SP_SESSION_NAME,
      password: SESSION_SECRET,
    })
    const data = session.data as Record<string, unknown>

    if (!data.claims) {
      throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
    }

    return data.claims
  })
}
