import type { AuthFlowState } from '@openape/core'
import type { EventHandler } from 'h3'
import { createAuthorizationURL, discoverIdP } from '@openape/auth'
import { createError, defineEventHandler, getRequestURL, readBody, useSession } from 'h3'
import type { SPConfig } from '../config.js'

const FLOW_COOKIE = 'openape-flow'
const SESSION_SECRET = 'e2e-test-session-secret-at-least-32-chars!'

export function createApiLoginHandler(config: SPConfig): EventHandler {
  return defineEventHandler(async (event) => {
    const body = await readBody<{ email: string }>(event)
    const origin = getRequestURL(event).origin
    const redirectUri = `${origin}/api/callback`

    if (!body?.email || !body.email.includes('@')) {
      throw createError({ statusCode: 400, statusMessage: 'Valid email required' })
    }

    const email = body.email.trim()

    const idpConfig = await discoverIdP(email, config.resolverOptions)
    if (!idpConfig) {
      const domain = email.split('@')[1]
      throw createError({ statusCode: 404, statusMessage: `No DDISA IdP found for domain "${domain}"` })
    }

    const { url, flowState } = await createAuthorizationURL(idpConfig, {
      clientId: config.clientId,
      redirectUri,
      email,
    })

    // Store flow state in encrypted cookie (matches Nuxt SP behavior)
    const session = await useSession(event, {
      name: FLOW_COOKIE,
      password: SESSION_SECRET,
      maxAge: 600,
    })
    await session.update({
      state: flowState.state,
      flow: flowState,
      exp: Date.now() + 10 * 60 * 1000,
    })

    return { redirectUrl: url }
  })
}

export async function getFlowState(event: import('h3').H3Event, expectedState: string): Promise<AuthFlowState | null> {
  const session = await useSession(event, {
    name: FLOW_COOKIE,
    password: SESSION_SECRET,
  })
  const data = session.data
  if (!data?.state) return null
  if (data.state !== expectedState) return null
  if ((data.exp as number) < Date.now()) return null
  return data.flow as AuthFlowState
}

export async function clearFlowState(event: import('h3').H3Event): Promise<void> {
  const session = await useSession(event, {
    name: FLOW_COOKIE,
    password: SESSION_SECRET,
  })
  await session.clear()
}

export { SESSION_SECRET }
