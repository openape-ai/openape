/** Policy modes controlling SP admission */
export type PolicyMode = 'open' | 'allowlist-admin' | 'allowlist-user' | 'deny'

/** Parsed DDISA DNS TXT record */
export interface DDISARecord {
  /** Version tag (e.g. 'ddisa1') */
  version: string
  /** IdP URL from DNS */
  idp: string
  /** Policy mode */
  mode?: PolicyMode
  /** Priority (lower = higher, like MX records) */
  priority?: number
  /** Policy endpoint URL */
  policy_endpoint?: string
  /** Raw TXT record string */
  raw: string
}

/** SP Manifest published at /.well-known/sp-manifest.json */
export interface SPManifest {
  /** Service Provider identifier (typically a domain) */
  sp_id: string
  /** Display name */
  name: string
  /** Redirect URIs for callback */
  redirect_uris: string[]
  /** JWKS URI for SP's public keys */
  jwks_uri?: string
  /** SP description */
  description?: string
  /** Logo URL */
  logo_uri?: string
  /** Contact email */
  contact?: string
}

/** DDISA Assertion JWT claims */
export interface DDISAAssertionClaims {
  /** Issuer — must match DNS-delegated IdP */
  iss: string
  /** Subject — user identifier (e.g. alice@example.com) */
  sub: string
  /** Audience — must match sp_id */
  aud: string
  /** Issued at (unix timestamp) */
  iat: number
  /** Expiration (unix timestamp, max 5 min from iat) */
  exp: number
  /** Nonce for replay protection */
  nonce: string
  /** JWT ID */
  jti?: string
}

/** OpenAPE grant types */
export type GrantType = 'once' | 'timed' | 'always'

/** OpenAPE grant status */
export type GrantStatus = 'pending' | 'approved' | 'denied' | 'revoked' | 'expired' | 'used'

/** OpenAPE grant request */
export interface OpenApeGrantRequest {
  /** Who is requesting (agent/service identifier) */
  requester: string
  /** Target system/resource */
  target: string
  /** Grant type */
  grant_type: GrantType
  /** Requested permissions */
  permissions?: string[]
  /** Plaintext command (for display in approval UI) */
  command?: string[]
  /** Command hash for direct/local mode */
  cmd_hash?: string
  /** Duration in seconds (for 'timed' grants) */
  duration?: number
  /** Human-readable reason for the request */
  reason?: string
}

/** OpenAPE grant */
export interface OpenApeGrant {
  /** Unique grant ID */
  id: string
  /** Grant request details */
  request: OpenApeGrantRequest
  /** Current status */
  status: GrantStatus
  /** Who approved/denied */
  decided_by?: string
  /** When the grant was created */
  created_at: number
  /** When the decision was made */
  decided_at?: number
  /** When the grant expires */
  expires_at?: number
  /** When the grant was used (for 'once' grants) */
  used_at?: number
}

/** OpenAPE AuthZ-JWT claims */
export interface OpenApeAuthZClaims {
  /** Issuer — OpenAPE server */
  iss: string
  /** Subject — the requester */
  sub: string
  /** Audience — target system */
  aud: string
  /** Issued at */
  iat: number
  /** Expiration */
  exp: number
  /** JWT ID */
  jti: string
  /** Grant ID reference */
  grant_id: string
  /** Grant type */
  grant_type: GrantType
  /** Permissions array */
  permissions?: string[]
  /** Command hash */
  cmd_hash?: string
  /** Nonce */
  nonce?: string
}

/** DNS resolver options */
export interface ResolverOptions {
  /** Cache TTL in seconds (default: 300) */
  cacheTTL?: number
  /** DoH provider URL (for edge/browser) */
  dohProvider?: string
  /** Skip cache */
  noCache?: boolean
  /** Mock records for testing */
  mockRecords?: Record<string, Omit<DDISARecord, 'raw'>>
}

/** Authorization request parameters (SP → IdP redirect) */
export interface AuthorizationRequest {
  /** SP identifier */
  sp_id: string
  /** Redirect URI for callback */
  redirect_uri: string
  /** CSRF protection state */
  state: string
  /** PKCE code challenge */
  code_challenge: string
  /** PKCE code challenge method (always S256) */
  code_challenge_method: 'S256'
  /** Nonce for replay protection */
  nonce: string
  /** Response type (always 'code') */
  response_type: 'code'
}

/** Token exchange request (SP → IdP backchannel) */
export interface TokenExchangeRequest {
  /** Authorization code */
  code: string
  /** PKCE code verifier */
  code_verifier: string
  /** Redirect URI (must match authorization request) */
  redirect_uri: string
  /** SP identifier */
  sp_id: string
  /** Grant type (always 'authorization_code') */
  grant_type: 'authorization_code'
}

/** Stored auth flow state (for PKCE, state, nonce validation) */
export interface AuthFlowState {
  /** PKCE code verifier */
  codeVerifier: string
  /** State parameter */
  state: string
  /** Nonce */
  nonce: string
  /** IdP URL */
  idpUrl: string
  /** Created timestamp */
  createdAt: number
}
