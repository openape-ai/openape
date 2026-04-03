import type { AuthFlowState } from '@openape/core'
import type { EventHandler } from 'h3'
import { createAuthorizationURL, discoverIdP } from '@openape/auth'
import { createError, defineEventHandler, getQuery } from 'h3'
import type { SPConfig } from '../config.js'

// In-memory flow state storage (keyed by state parameter)
const flowStates = new Map<string, AuthFlowState>()

export function createLoginHandler(config: SPConfig): EventHandler {
  return defineEventHandler(async (event) => {
    const query = getQuery(event)
    const email = String(query.email ?? '')
    if (!email) {
      throw createError({ statusCode: 400, message: 'Missing ?email= parameter' })
    }

    const idpConfig = await discoverIdP(email, config.resolverOptions)
    if (!idpConfig) {
      throw createError({ statusCode: 404, message: 'IdP not found for this domain' })
    }

    const { url, flowState } = await createAuthorizationURL(idpConfig, {
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      email,
    })

    // Store flow state keyed by state param
    flowStates.set(flowState.state, flowState)

    return { redirectUrl: url }
  })
}

export { flowStates }
