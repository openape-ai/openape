export function useOrg() {
  const config = useRuntimeConfig()
  const baseDomain = config.public.domain as string
  const baseDomainWithoutPort = baseDomain.split(':')[0]

  const host = import.meta.server
    ? useRequestHeaders()?.host || baseDomain
    : window.location.host

  const hostWithoutPort = host.split(':')[0] ?? ''

  const isMainDomain = hostWithoutPort === baseDomainWithoutPort
  let slug: string | null = null

  if (!isMainDomain && baseDomainWithoutPort && hostWithoutPort.endsWith(`.${baseDomainWithoutPort}`)) {
    slug = hostWithoutPort.slice(0, -(baseDomainWithoutPort.length + 1))
  }
  else if (!isMainDomain) {
    // Custom domain — slug will be resolved server-side
    slug = null
  }

  return {
    isMainDomain,
    slug,
    host,
    baseDomain,
  }
}
