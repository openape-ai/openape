import type { OpenApeCliAuthorizationDetail, OpenApeExecutionContext, ScopeRiskLevel } from '@openape/core'

export interface AdapterDefinition {
  schema: string
  cli: {
    id: string
    executable: string
    audience?: string
    version?: string
  }
  operations: AdapterOperation[]
}

export interface AdapterOperation {
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
  adapter: AdapterDefinition
  source: string
  digest: string
}

export interface ResolvedCommand {
  adapter: AdapterDefinition
  source: string
  digest: string
  executable: string
  commandArgv: string[]
  bindings: Record<string, string>
  detail: OpenApeCliAuthorizationDetail
  executionContext: OpenApeExecutionContext
  permission: string
}

export interface CommandResolutionResult {
  resolved: ResolvedCommand | null
  fallback: FallbackCommand | null
}

export interface FallbackCommand {
  command: string
  argv: string[]
  hash: string
  permission: string
  display: string
  risk: ScopeRiskLevel
}
