import { createError, defineEventHandler, getRequestURL, readBody } from 'h3'
import { createAuthorizationURL, discoverIdP } from '@openape/auth'
import { getSpConfig, saveFlowState } from '../utils/sp-config'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email: string }>(event)
  const { clientId, openapeUrl, fallbackIdpUrl } = getSpConfig()
  const origin = getRequestURL(event).origin
  const redirectUri = `${origin}/api/callback`

  if (!body?.email || !body.email.includes('@')) {
    throw createError({ statusCode: 400, statusMessage: 'Valid email required' })
  }

  const email = body.email.trim()
  const domain = email.split('@')[1]

  // Use configured IdP URL (dev/test) or discover via DNS (with fallback)
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
