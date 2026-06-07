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
    redirect_uris: [`${origin}/api/callback`],
    client_uri: origin,
    contacts: [],
  })
})
