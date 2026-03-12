import { defineEventHandler, getRequestURL } from 'h3'
import { createClientMetadata } from '@openape/auth'
import { getSpConfig } from '../../utils/sp-config'

export default defineEventHandler((event) => {
  const { clientId, spName } = getSpConfig()
  const origin = getRequestURL(event).origin
  return createClientMetadata({
    client_id: clientId,
    client_name: spName,
    redirect_uris: [`${origin}/api/callback`],
    client_uri: origin,
    contacts: [],
  })
})
