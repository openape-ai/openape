import type { AgentModelSize, AgentProvider, AgentThinking } from '../../contracts/agent'
import type { AgentWireThinking } from '../../contracts/agent-metadata'

export type AgentProtocol = 'messages' | 'chat-completions' | 'responses'
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
export interface ProxySnapshot { revision: string, hash: string, baseUrl: string, keyFile: string, model: ProxyModelConfig, effectiveThinking: AgentThinking, wireThinking: AgentWireThinking, connectionId?: import('../../contracts/model-api').ModelApiId, authentication?: 'none' | 'token', catalog?: { hash: string, checkedAt: string }, family?: string, version?: string }

export type CredentialReference = { type: 'external', path: string } | { type: 'managed', id: string }
export interface ModelApiConnection {
  id: import('../../contracts/model-api').ModelApiId
  enabled: boolean
  baseUrl: string
  format: AgentProtocol
  authentication: 'none' | 'token'
  credential?: CredentialReference
  defaultThinking: AgentThinking
}
export type FamilyPolicy = Omit<ProxyModelConfig, 'modelId' | 'protocol'> & { family: string }
export interface ModelApiConfig {
  schemaVersion: 2
  revision: string
  resolverVersion: '1'
  connections: Record<import('../../contracts/model-api').ModelApiId, ModelApiConnection>
  models: Record<AgentProvider, Partial<Record<AgentModelSize, FamilyPolicy>>>
}
export interface ModelCatalogEntry { id: string, owned_by?: string, max_tokens?: number }
export interface ModelCatalog { entries: ModelCatalogEntry[], hash: string, checkedAt: string }
