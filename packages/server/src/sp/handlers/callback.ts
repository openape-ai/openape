import type { DDISAAssertionClaims } from '@openape/core'
import type { EventHandler } from 'h3'
import { handleCallback as authHandleCallback } from '@openape/auth'
import { createError, defineEventHandler, getQuery } from 'h3'
import type { SPConfig } from '../config.js'
import { flowStates } from './login.js'

// In-memory session storage (keyed by session token)
const sessions = new Map<string, DDISAAssertionClaims>()

export function createCallbackHandler(config: SPConfig): EventHandler {
  return defineEventHandler(async (event) => {
    const query = getQuery(event)
    const code = String(query.code ?? '')
    const state = String(query.state ?? '')

    if (!code || !state) {
      throw createError({ statusCode: 400, message: 'Missing code or state' })
    }

    const flowState = flowStates.get(state)
    if (!flowState) {
      throw createError({ statusCode: 400, message: 'Invalid or expired state' })
    }
    flowStates.delete(state)

    const result = await authHandleCallback({
      code,
      state,
      flowState,
      clientId: config.clientId,
      redirectUri: config.redirectUri,
    })

    // Store claims in a simple session
    const sessionId = crypto.randomUUID()
    sessions.set(sessionId, result.claims)

    return { sessionId, claims: result.claims }
  })
}

export { sessions }
