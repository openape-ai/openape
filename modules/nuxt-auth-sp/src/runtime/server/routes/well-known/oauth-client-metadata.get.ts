import { defineEventHandler, getRequestURL } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { createClientMetadata } from '@openape/auth'
import { getClientId, getSpConfig } from '../../utils/sp-config'

export default defineEventHandler((event) => {
  const { spName } = getSpConfig()
  const configured = (useRuntimeConfig().openapeSp as { additionalRedirectUris?: string[] }).additionalRedirectUris ?? []
  if (!Array.isArray(configured) || configured.some((value) => {
    try {
      const url = new URL(value)
      const localFixture = process.env.OPENAPE_SP_ALLOW_INSECURE_IDP === '1' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
      return (url.protocol !== 'https:' && !localFixture) || !!url.username || !!url.password || !!url.hash || !!url.search
    }
    catch { return true }
  })) {
    throw new Error('additionalRedirectUris must contain explicit HTTPS callback URLs')
  }
  const clientId = getClientId(event)
  const origin = getRequestURL(event).origin
  return createClientMetadata({
    client_id: clientId,
    client_name: spName,
    redirect_uris: [
      `${origin}/api/callback`,
      ...configured,
      // Generic cross-SP delegation return: where the IdP sends the Owner
      // back after issuing a delegation authorization code (redirect/code
      // flow), so the SP's server can redeem it and talk SP↔SP. One path,
      // published by every SP — harmless for those that don't implement it.
      // Belongs in the DDISA sp-data-access spec as the standard delegation
      // callback. See @openape/protocol sp-data-access.md.
      `${origin}/oauth/grants/callback`,
    ],
    client_uri: origin,
    contacts: [],
  })
})
