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

/** Actor type — distinguishes human users from automated agents */
export type ActorType = 'human' | 'agent'

/** RFC 8693 act claim — identifies who is actually performing the action during delegation */
export interface DelegationActClaim {
  /** The identity actually performing the action (delegate) */
  sub: string
}

/** Delegate claim — included when an agent acts on behalf of a human */
export interface DDISADelegateClaim {
  /** Agent identifier (email) */
  sub: string
  /** Always 'agent' — the delegate is an agent */
  act: 'agent'
  /** Grant ID that authorized the delegation */
  grant_id: string
}

/** DDISA Assertion JWT claims */
export interface DDISAAssertionClaims {
  /** Issuer — must match DNS-delegated IdP */
  iss: string
  /** Subject — user identifier. During delegation: the delegator (person being acted on behalf of) */
  sub: string
  /** Audience — must match sp_id */
  aud: string
  /** Actor type or RFC 8693 delegation claim. String = actor type. Object = delegation with delegate sub. */
  act: ActorType | DelegationActClaim
  /** Issued at (unix timestamp) */
  iat: number
  /** Expiration (unix timestamp, max 5 min from iat) */
  exp: number
  /** Nonce for replay protection */
  nonce: string
  /** JWT ID */
  jti?: string
  /** Delegate info — present when an agent acts as a human via delegate grant */
  delegate?: DDISADelegateClaim
  /** Grant ID that authorized the delegation (RFC 8693) */
  delegation_grant?: string
}

/** OpenApe grant types */
export type GrantType = 'once' | 'timed' | 'always'

/** OpenApe grant status */
export type GrantStatus = 'pending' | 'approved' | 'denied' | 'revoked' | 'expired' | 'used'

/** OpenApe grant request */
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
  /** Delegator — who is being acted on behalf of (delegation grants only) */
  delegator?: string
  /** Delegate — who is allowed to act (delegation grants only) */
  delegate?: string
  /** Audience — at which SP the delegation is valid (delegation grants only) */
  audience?: string
  /** Scopes — what actions are allowed under the delegation */
  scopes?: string[]
}

/** Grant category */
export type GrantCategory = 'command' | 'delegation'

/** OpenApe grant */
export interface OpenApeGrant {
  /** Unique grant ID */
  id: string
  /** Grant category: command (default) or delegation */
  type?: GrantCategory
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

/** RFC 9396 Rich Authorization Request — OpenApe Grant type */
export interface OpenApeAuthorizationDetail {
  type: 'openape_grant'
  action: string
  locations?: string[]
  approval?: GrantType
  reason?: string
  grant_id?: string
}

/** OpenApe AuthZ-JWT claims */
export interface OpenApeAuthZClaims {
  /** Issuer — OpenApe server */
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
  /** Plaintext command array (for apes grant-token mode) */
  command?: string[]
  /** Nonce */
  nonce?: string
  /** Who approved/denied the grant */
  decided_by?: string
  /** Grant approval type (once/timed/always) */
  approval?: GrantType
  /** Run command as this user */
  run_as?: string
}

// --- openape.json SP Capability Manifest (Prompt 15) ---

/** Risk level for a scope */
export type ScopeRiskLevel = 'low' | 'medium' | 'high' | 'critical'

/** A scope (capability) that the SP offers */
export interface OpenApeScope {
  /** Human-readable name */
  name: string
  /** Description of what this scope allows */
  description: string
  /** Risk level */
  risk: ScopeRiskLevel
  /** Category key (references OpenApeManifest.categories) */
  category?: string
  /** Expected parameters (informational) */
  parameters?: Record<string, { type: string, description: string }>
}

/** Category for grouping scopes in UI */
export interface OpenApeScopeCategory {
  /** Display name */
  name: string
  /** Icon (emoji or URL) */
  icon?: string
}

/** SP policies published in the manifest */
export interface OpenApePolicies {
  /** Agent access policy */
  agent_access?: PolicyMode
  /** Whether delegation is allowed */
  delegation?: 'allowed' | 'denied'
  /** Max delegation duration (e.g. "30d", "1y") */
  max_delegation_duration?: string | null
  /** Which risk levels require a grant, and of what type */
  require_grant_for_risk?: Partial<Record<ScopeRiskLevel, GrantType | null>>
  /** Which risk levels require MFA */
  require_mfa_for_risk?: Partial<Record<ScopeRiskLevel, boolean>>
}

/** Rate limit for a scope */
export interface OpenApeRateLimit {
  max_per_hour?: number
  max_per_day?: number
  max_amount_per_day?: number
}

/** openape.json — SP Capability Manifest */
export interface OpenApeManifest {
  /** Schema version */
  version: string
  /** Service info */
  service: {
    name: string
    description?: string
    url: string
    icon?: string
    privacy_policy?: string
    terms?: string
    contact?: string
  }
  /** Auth methods */
  auth?: {
    ddisa_domain?: string
    oidc_client_id?: string
    supported_methods: ('ddisa' | 'oidc')[]
    login_url?: string
  }
  /** Scopes the SP offers */
  scopes?: Record<string, OpenApeScope>
  /** Scope categories for UI grouping */
  categories?: Record<string, OpenApeScopeCategory>
  /** SP policies */
  policies?: OpenApePolicies
  /** Rate limits per scope */
  rate_limits?: Record<string, OpenApeRateLimit>
  /** API endpoint info */
  endpoints?: {
    api_base?: string
    openapi?: string
    grant_verify?: string
  }
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
