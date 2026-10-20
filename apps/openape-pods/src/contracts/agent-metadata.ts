import type { AgentBackend, AgentModelSize, AgentProvider, AgentThinking } from './agent'
import type { SafeAgentError } from './agent-errors'

export type AgentWireThinking = { type: 'enabled', budget_tokens: number } | { type: 'adaptive', effort: AgentThinking } | { reasoning_effort: AgentThinking }
export interface AgentUsage { source: 'messages.usage' | 'chat-completions.usage' | 'native', unit: 'tokens', input?: number, output?: number, total?: number, reasoning?: number, cacheRead?: number, cacheCreation?: number }
export interface AgentCallMetadata {
  callId: string
  backend: AgentBackend
  provider: AgentProvider
  modelSize: AgentModelSize | null
  modelId: string | null
  reportedModelId: string | null
  requestedThinking: AgentThinking | null
  effectiveThinking: AgentThinking | null
  wireThinking: AgentWireThinking | null
  configRevision: string | null
  configHash: string | null
  modelSelection?: 'account-default' | 'explicit-mapping'
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout'
  threadId: string | null
  upstreamId?: string
  usage?: AgentUsage
  error?: SafeAgentError
}

export function freezeAgentMetadata(value: AgentCallMetadata): AgentCallMetadata {
  return Object.freeze({ ...value, ...(value.wireThinking ? { wireThinking: Object.freeze({ ...value.wireThinking }) } : {}), ...(value.usage ? { usage: Object.freeze({ ...value.usage }) } : {}), ...(value.error ? { error: Object.freeze({ ...value.error, details: Object.freeze({ ...value.error.details }) }) } : {}) })
}
