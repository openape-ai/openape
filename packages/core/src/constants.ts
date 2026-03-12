/** Maximum assertion TTL in seconds (5 minutes per spec) */
export const MAX_ASSERTION_TTL = 300

/** Fixed algorithm — EdDSA (Ed25519) per DDISA spec */
export const ALGORITHM = 'EdDSA' as const

/** Well-known paths */
export const WELL_KNOWN_JWKS = '/.well-known/jwks.json'
export const WELL_KNOWN_OAUTH_CLIENT_METADATA = '/.well-known/oauth-client-metadata'
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
