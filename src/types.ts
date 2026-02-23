/** Proxy configuration (parsed from TOML/JSON) */
export interface ProxyConfig {
  proxy: {
    listen: string
    idp_url: string
    agent_email: string
    default_action: 'block' | 'request' | 'request-async'
    audit_log?: string
  }
  allow: RuleEntry[]
  deny: RuleEntry[]
  grant_required: GrantRuleEntry[]
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
  rule: string
  waited_ms?: number
  error?: string
}
