import { defineEventHandler, getRequestURL } from 'h3'
import { createClientMetadata } from '@openape/auth'
import { getClientId, getSpConfig } from '../../utils/sp-config'

export default defineEventHandler((event) => {
  const { spName } = getSpConfig()
  const clientId = getClientId(event)
  const origin = getRequestURL(event).origin
  return createClientMetadata({
    client_id: clientId,
    client_name: spName,
    redirect_uris: [
      `${origin}/api/callback`,
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
