/** Maximum assertion TTL in seconds (5 minutes per spec) */
export const MAX_ASSERTION_TTL = 300

/** Fixed algorithm — no negotiation per spec */
export const ALGORITHM = 'ES256' as const

/** Well-known paths */
export const WELL_KNOWN_JWKS = '/.well-known/jwks.json'
export const WELL_KNOWN_SP_MANIFEST = '/.well-known/sp-manifest.json'
export const WELL_KNOWN_OPENID_CONFIG = '/.well-known/openid-configuration'

/** Default DNS cache TTL in seconds */
export const DEFAULT_DNS_CACHE_TTL = 300

/** DoH providers with CORS support */
export const DOH_PROVIDERS = [
  'https://cloudflare-dns.com/dns-query',
  'https://dns.google/resolve',
  'https://dns.quad9.net:5053/dns-query',
] as const

/** DNS TXT record type number */
export const DNS_TXT_TYPE = 16
