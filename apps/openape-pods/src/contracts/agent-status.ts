import type { AgentModelSize, AgentProvider, AgentThinking } from './agent'
import type { SafeAgentError } from './agent-errors'

export interface AgentBackendStatus {
  configured: boolean
  enabled: boolean
  available: boolean
  revision?: string
  hash?: string
  error?: SafeAgentError
  connections?: (import('./model-api').ModelApiSettings & { id: import('./model-api').ModelApiId, hasToken: boolean, restartRequired?: boolean, checkedAt?: string, error?: SafeAgentError })[]
  mappings: { provider: AgentProvider, modelSize: AgentModelSize, modelId: string, error?: SafeAgentError, enabled: boolean, defaultThinking: AgentThinking, thinking: AgentThinking[], capabilityEvidenceVersion: string }[]
}
