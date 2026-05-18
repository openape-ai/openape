/** Single-agent proxy configuration (legacy format, parsed from TOML/JSON) */
export interface ProxyConfig {
  proxy: {
    listen: string
    idp_url: string
    agent_email: string
    default_action: 'allow' | 'block' | 'request' | 'request-async'
    mandatory_auth?: boolean
  }
  allow: RuleEntry[]
  deny: RuleEntry[]
  grant_required: GrantRuleEntry[]
}

/** Multi-agent proxy configuration */
export interface MultiAgentProxyConfig {
  proxy: {
    listen: string
    default_action: 'allow' | 'block' | 'request' | 'request-async'
    mandatory_auth?: boolean
  }
  agents: AgentConfig[]
}

export interface AgentConfig {
  email: string
  idp_url: string
  allow?: RuleEntry[]
  deny?: RuleEntry[]
  grant_required?: GrantRuleEntry[]
}

export interface RuleEntry {
  domain: string
  methods?: string[]
  path?: string
  note?: string
}

export interface GrantRuleEntry extends RuleEntry {
  grant_type: 'once' | 'timed' | 'always'
  permissions?: string[]
  duration?: number
}

export type RuleAction =
  | { type: 'allow' }
  | { type: 'deny'; note?: string }
  | { type: 'grant_required'; rule: GrantRuleEntry }

export interface AuditEntry {
  ts: string
  agent: string
  action: 'allow' | 'deny' | 'grant_approved' | 'grant_denied' | 'grant_timeout' | 'error'
  domain: string
  method: string
  path: string
  grant_id?: string | null
  request_hash?: string
  rule: string
  waited_ms?: number
  error?: string
}

/** A single secret entry parsed from the daemon's stdin TOML payload. */
export interface SecretEntry {
  name: string
  target: string
  header: string
  template: string
  value: string
}

/** In-memory secret lookup, used by the inject hook. */
export interface SecretsStore {
  readonly entries: readonly SecretEntry[]
  findFor: (target: URL) => SecretEntry | null
}

/** Daemon identity loaded from ~/.config/apes/auth.json. */
export interface DaemonIdentity {
  email: string
  idpUrl: string
  bearer: string
}
