import type { OpenApeCliAuthorizationDetail, OpenApeExecutionContext, ScopeRiskLevel } from '@openape/core'

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
