import { defineEventHandler, getRequestURL, setResponseHeader } from 'h3'
import { TROOP_SCOPES } from '../../utils/scope-catalog'

// Overrides the @openape/nuxt-auth-sp module's default openape.json
// handler so we can inject troop's scope catalog (spec
// sp-data-access.md §3) without forking the module. Receiver SPs
// read this to discover what they may request
// in a delegation grant.
export default defineEventHandler((event) => {
  const origin = getRequestURL(event).origin

  setResponseHeader(event, 'Access-Control-Allow-Origin', '*')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')

  return {
    version: '1.0',
    service: {
      name: 'OpenApe Troop',
      url: origin,
    },
    auth: {
      ddisa_domain: 'troop.openape.ai',
      supported_methods: ['ddisa'],
    },
    scopes: TROOP_SCOPES,
  }
})
