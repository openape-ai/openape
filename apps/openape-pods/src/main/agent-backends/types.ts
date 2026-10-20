import type { AgentModelSize, AgentProvider, AgentThinking } from '../../contracts/agent'
import type { AgentWireThinking } from '../../contracts/agent-metadata'

export type AgentProtocol = 'messages' | 'chat-completions'
export interface ProxyThinkingConfig { enabled: boolean, translation: AgentWireThinking }
export interface ProxyModelConfig {
  enabled: boolean
  modelId: string
  protocol: AgentProtocol
  defaultThinking: AgentThinking
  thinking: Record<AgentThinking, ProxyThinkingConfig>
  outputLimit: number
  capabilityEvidenceVersion: string
}
export interface AgentBackendConfig {
  schemaVersion: 1
  revision: string
  proxy: { enabled: boolean, baseUrl: string, keyFile: string, keyField: 'api_key', models: Record<AgentProvider, Partial<Record<AgentModelSize, ProxyModelConfig>>> }
}
export type { AgentBackendStatus } from '../../contracts/agent-status'
export interface ProxySnapshot { revision: string, hash: string, baseUrl: string, keyFile: string, model: ProxyModelConfig, effectiveThinking: AgentThinking, wireThinking: AgentWireThinking }
