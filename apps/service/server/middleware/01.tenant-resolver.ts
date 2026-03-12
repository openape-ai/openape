import type { H3Event } from 'h3'
import { getRequestHost } from 'h3'

export default defineEventHandler(async (event: H3Event) => {
  const config = useRuntimeConfig()
  const baseDomain = config.public.domain as string // e.g. cloud.openape.at or lvh.me:3000

  const host = getRequestHost(event) // includes port if present
  const baseDomainWithoutPort = baseDomain.split(':')[0]
  const hostWithoutPort = host.split(':')[0]

  // Main domain — no tenant
  if (host === baseDomain || hostWithoutPort === baseDomainWithoutPort) {
    // Check if it's a subdomain or exact match
    if (hostWithoutPort === baseDomainWithoutPort) {
      event.context.isMainDomain = true
      event.context.tenantSlug = null
      return
    }
  }

  // Subdomain: {slug}.cloud.openape.at
  if (hostWithoutPort.endsWith(`.${baseDomainWithoutPort}`)) {
    const slug = hostWithoutPort.slice(0, -(baseDomainWithoutPort.length + 1))
    if (slug && !slug.includes('.')) {
      event.context.tenantSlug = slug
      event.context.isMainDomain = false
      return
    }
  }

  // Custom domain: look up in domain-map
  const platformStorage = useStorage('openape-platform')
  const slug = await platformStorage.getItem<string>(`domain-map:${hostWithoutPort}`)
  if (slug) {
    event.context.tenantSlug = slug
    event.context.isMainDomain = false
    event.context.isCustomDomain = true
    event.context.customDomainHost = host
    return
  }

  // Unknown host — treat as main domain (will 404 naturally)
  event.context.isMainDomain = true
  event.context.tenantSlug = null
})
