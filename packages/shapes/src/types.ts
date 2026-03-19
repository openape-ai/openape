import type { OpenApeCliAuthorizationDetail, OpenApeExecutionContext, OpenApeGrantRequest, ScopeRiskLevel } from '@openape/core'

export interface ShapesAdapter {
  schema: string
  cli: {
    id: string
    executable: string
    audience?: string
    version?: string
  }
  operations: ShapesOperation[]
}

export interface ShapesOperation {
  id: string
  command: string[]
  positionals?: string[]
  required_options?: string[]
  display: string
  action: string
  risk: ScopeRiskLevel
  resource_chain: string[]
  exact_command?: boolean
}

export interface LoadedAdapter {
  adapter: ShapesAdapter
  source: string
  digest: string
}

export interface ResolvedCommand {
  adapter: ShapesAdapter
  source: string
  digest: string
  executable: string
  commandArgv: string[]
  bindings: Record<string, string>
  detail: OpenApeCliAuthorizationDetail
  executionContext: OpenApeExecutionContext
  permission: string
}

export interface ResolvedCapability {
  adapter: ShapesAdapter
  source: string
  digest: string
  executable: string
  details: OpenApeCliAuthorizationDetail[]
  executionContext: OpenApeExecutionContext
  permissions: string[]
  summary: string
}

export interface GrantRequestOptions {
  requester: string
  target_host: string
  grant_type: 'once' | 'timed' | 'always'
  reason?: string
  run_as?: string
}

export interface BuiltGrantRequest {
  request: OpenApeGrantRequest
}
