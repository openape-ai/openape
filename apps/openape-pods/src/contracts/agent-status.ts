import type { AgentModelSize, AgentProvider, AgentThinking } from './agent'
import type { SafeAgentError } from './agent-errors'

export interface AgentBackendStatus {
  configured: boolean
  enabled: boolean
  available: boolean
  revision?: string
  hash?: string
  error?: SafeAgentError
  mappings: { provider: AgentProvider, modelSize: AgentModelSize, modelId: string, enabled: boolean, defaultThinking: AgentThinking, thinking: AgentThinking[], capabilityEvidenceVersion: string }[]
}
