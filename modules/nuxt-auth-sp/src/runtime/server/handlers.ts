import type { H3Event } from 'h3'
import { createError, defineEventHandler, getQuery, getRequestURL, readBody, sendRedirect } from 'h3'
import { createAuthorizationURL, createClientMetadata, discoverIdP, handleCallback } from '@openape/auth'
import type { DDISAAssertionClaims } from '@openape/core'
import { getSpConfig, saveFlowState, getFlowState, clearFlowState } from './utils/sp-config'

export interface LoginHandlerOptions {
  callbackPath: string
}

export interface CallbackHandlerOptions {
  onSuccess: (event: H3Event, result: {
    claims: DDISAAssertionClaims
    rawAssertion: string
  }) => Promise<void>
  onError?: (event: H3Event, error: Error) => Promise<void>
}

export interface ClientMetadataHandlerOptions {
  callbackPath: string
  clientUri?: string
}

export function defineOpenApeLoginHandler(options: LoginHandlerOptions) {
  return defineEventHandler(async (event) => {
    const body = await readBody<{ email: string }>(event)
    const { clientId, openapeUrl, fallbackIdpUrl } = getSpConfig()
    const origin = getRequestURL(event).origin
    const redirectUri = `${origin}${options.callbackPath}`

    if (!body?.email || !body.email.includes('@')) {
      throw createError({ statusCode: 400, statusMessage: 'Valid email required' })
    }

    const email = body.email.trim()
    const domain = email.split('@')[1]

    let idpConfig
    if (openapeUrl) {
      idpConfig = { idpUrl: openapeUrl, record: { version: 'ddisa1', idp: openapeUrl, raw: `v=ddisa1; idp=${openapeUrl}` } }
    }
    else {
      idpConfig = await discoverIdP(email, { fallbackIdpUrl: fallbackIdpUrl || undefined })
    }

    if (!idpConfig) {
      throw createError({
        statusCode: 404,
        statusMessage: `No DDISA IdP found for domain "${domain}"`,
      })
    }

    const { url, flowState } = await createAuthorizationURL(idpConfig, {
      clientId,
      redirectUri,
      email,
    })

    await saveFlowState(event, flowState.state, flowState)

    return { redirectUrl: url }
  })
}

export function defineOpenApeCallbackHandler(options: CallbackHandlerOptions) {
  return defineEventHandler(async (event) => {
    const query = getQuery(event)
    const { code, state, error, error_description } = query as Record<string, string>
    const { clientId } = getSpConfig()
    const origin = getRequestURL(event).origin

    if (error) {
      const msg = error_description || error
      if (options.onError) {
        await options.onError(event, new Error(msg))
        return
      }
      return sendRedirect(event, `/login?error=${encodeURIComponent(msg)}`)
    }

    if (!code || !state) {
      const err = new Error('Missing code or state parameter')
      if (options.onError) {
        await options.onError(event, err)
        return
      }
      return sendRedirect(event, `/login?error=${encodeURIComponent(err.message)}`)
    }

    const flowState = await getFlowState(event, state)
    if (!flowState) {
      const err = new Error('Invalid or expired state — please try again')
      if (options.onError) {
        await options.onError(event, err)
        return
      }
      return sendRedirect(event, `/login?error=${encodeURIComponent(err.message)}`)
    }

    try {
      // Reconstruct redirectUri from the flow's original callback path
      // We need to know which path was used during login — use the referer or config
      // The safest approach: use the current request's origin + derive from the IdP's redirect
      const redirectUri = `${origin}${getRequestURL(event).pathname}`

      const result = await handleCallback({
        code,
        state,
        flowState,
        clientId,
        redirectUri,
      })

      await clearFlowState(event)
      await options.onSuccess(event, { claims: result.claims, rawAssertion: result.rawAssertion })
    }
    catch (err: unknown) {
      await clearFlowState(event)
      const error = err instanceof Error ? err : new Error('Callback processing failed')
      if (options.onError) {
        await options.onError(event, error)
        return
      }
      return sendRedirect(event, `/login?error=${encodeURIComponent(error.message)}`)
    }
  })
}

export function defineOpenApeClientMetadataHandler(options: ClientMetadataHandlerOptions) {
  return defineEventHandler((event) => {
    const { clientId, spName } = getSpConfig()
    const origin = getRequestURL(event).origin
    return createClientMetadata({
      client_id: clientId,
      client_name: spName,
      redirect_uris: [`${origin}${options.callbackPath}`],
      client_uri: options.clientUri || origin,
      contacts: [],
    })
  })
}
