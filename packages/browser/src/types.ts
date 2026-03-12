export type RuleApproval = 'once' | 'timed' | 'always'

export interface SimpleRule {
  pattern: string
}

export interface GrantRule {
  pattern: string
  methods?: string[]
  approval?: RuleApproval
  duration?: string
  includeBody?: boolean
}

export interface Rules {
  allow?: (string | SimpleRule)[]
  deny?: (string | SimpleRule)[]
  grantRequired?: (string | GrantRule)[]
}

export type DefaultAction = 'allow' | 'deny' | 'grant_required'

export interface AgentConfig {
  email: string
  key?: string
  token?: string
}

export interface GrantedBrowserOptions {
  agent: AgentConfig
  idp?: string
  rules?: Rules
  rulesFile?: string
  rulesFromIdp?: boolean
  defaultAction?: DefaultAction
  playwright?: Record<string, unknown>
  onGrantRequired?: (url: string) => Promise<'request' | 'deny'> | 'request' | 'deny'
  onGrantApproved?: (url: string, grantId: string) => void
  onGrantDenied?: (url: string) => void
}

export interface LoginAsOptions {
  as: string
  at: string
  delegationGrant: string
}

export interface GrantRequest {
  id: string
  status: string
}

export type RouteDecision = 'allow' | 'deny' | 'grant_required'

export interface MatchedGrantRule {
  rule: GrantRule
  decision: 'grant_required'
}
