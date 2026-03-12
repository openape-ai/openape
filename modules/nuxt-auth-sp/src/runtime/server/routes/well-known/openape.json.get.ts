import { defineEventHandler, getRequestURL, setResponseHeader } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { getSpConfig } from '../../utils/sp-config'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const { clientId, spName } = getSpConfig()
  const origin = getRequestURL(event).origin
  const manifest = (config.openapeSp as Record<string, unknown>).manifest as Record<string, unknown> | undefined

  // CORS — manifest is public
  setResponseHeader(event, 'Access-Control-Allow-Origin', '*')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')

  // Build manifest from config + defaults
  return {
    version: '1.0',
    service: {
      name: spName,
      url: origin,
      ...(manifest?.service as Record<string, unknown> || {}),
    },
    auth: {
      ddisa_domain: clientId,
      supported_methods: ['ddisa'],
      ...(manifest?.auth as Record<string, unknown> || {}),
    },
    ...(manifest?.scopes ? { scopes: manifest.scopes } : {}),
    ...(manifest?.categories ? { categories: manifest.categories } : {}),
    ...(manifest?.policies ? { policies: manifest.policies } : {}),
    ...(manifest?.rate_limits ? { rate_limits: manifest.rate_limits } : {}),
    ...(manifest?.endpoints ? { endpoints: manifest.endpoints } : {}),
  }
})
