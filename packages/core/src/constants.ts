/** Maximum assertion TTL in seconds (5 minutes per spec) */
export const MAX_ASSERTION_TTL = 300

/** Fixed algorithm — EdDSA (Ed25519) per DDISA spec */
export const ALGORITHM = 'EdDSA' as const

/** Well-known paths */
export const WELL_KNOWN_JWKS = '/.well-known/jwks.json'
export const WELL_KNOWN_OAUTH_CLIENT_METADATA = '/.well-known/oauth-client-metadata'
export const WELL_KNOWN_OPENID_CONFIG = '/.well-known/openid-configuration'

/** Default DNS cache TTL in seconds (positive results) */
export const DEFAULT_DNS_CACHE_TTL = 300

/**
 * Default DNS cache TTL in seconds for negative results — domains
 * with no DDISA TXT record. Shorter than the positive TTL so that a
 * domain that *just* added a record gets picked up reasonably fast.
 * Long enough to absorb typical authorize-storm patterns and prevent
 * an attacker from forcing repeated DNS queries by hammering
 * `/authorize?login_hint=foo@no-ddisa.com`.
 */
export const DEFAULT_DNS_NEGATIVE_CACHE_TTL = 60

/** DoH providers with CORS support */
export const DOH_PROVIDERS = [
  'https://cloudflare-dns.com/dns-query',
  'https://dns.google/resolve',
  'https://dns.quad9.net:5053/dns-query',
] as const

/** DNS TXT record type number */
export const DNS_TXT_TYPE = 16

/**
 * Delegation scopes for an IdP's own grants API (delegation.md §8). A
 * delegation whose audience is the IdP issuer and that carries these scopes
 * lets the delegate read the delegator's grants (`grants:read`) or submit
 * grant requests for the delegator's agents (`grants:request`). There is
 * deliberately no scope for deciding grants: requester ≠ approver.
 */
export const GRANTS_READ_SCOPE = 'grants:read' as const
export const GRANTS_REQUEST_SCOPE = 'grants:request' as const
export const GRANTS_DELEGATION_SCOPES = [GRANTS_READ_SCOPE, GRANTS_REQUEST_SCOPE] as const
export type GrantsDelegationScope = typeof GRANTS_DELEGATION_SCOPES[number]
