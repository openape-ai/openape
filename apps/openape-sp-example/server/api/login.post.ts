import { createAuthorizationURL, discoverIdP } from '@ddisa/sp-server'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email: string }>(event)
  const { spId } = getSpConfig()
  const origin = getRequestURL(event).origin
  const redirectUri = `${origin}/api/callback`

  if (!body?.email || !body.email.includes('@')) {
    throw createError({ statusCode: 400, statusMessage: 'Valid email required' })
  }

  const email = body.email.trim()
  const domain = email.split('@')[1]

  // Discover IdP via real DNS (DoH in edge runtime)
  const idpConfig = await discoverIdP(email)

  if (!idpConfig) {
    throw createError({
      statusCode: 404,
      statusMessage: `No DDISA IdP found for domain "${domain}"`,
    })
  }

  // Create authorization URL
  const { url, flowState } = await createAuthorizationURL(idpConfig, {
    spId,
    redirectUri,
    email,
  })

  // Save flow state in signed cookie (stateless — no server storage needed)
  await saveFlowState(event, flowState.state, flowState)

  return { redirectUrl: url }
})
