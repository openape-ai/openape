import type { EventHandler } from 'h3'
import { createError, defineEventHandler, getHeader } from 'h3'
import { sessions } from './callback.js'

export function createMeHandler(): EventHandler {
  return defineEventHandler((event) => {
    const auth = getHeader(event, 'authorization')
    if (!auth?.startsWith('Bearer ')) {
      throw createError({ statusCode: 401, message: 'Missing or invalid Authorization header' })
    }

    const sessionId = auth.slice('Bearer '.length)
    const claims = sessions.get(sessionId)
    if (!claims) {
      throw createError({ statusCode: 401, message: 'Invalid or expired session' })
    }

    return claims
  })
}
