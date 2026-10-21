import { agentThinkingLevels } from './agent'
import type { AgentThinking } from './agent'

export const modelApiIds = ['openai', 'anthropic'] as const
export type ModelApiId = typeof modelApiIds[number]
export type ModelApiFormat = 'chat-completions' | 'responses' | 'messages'
export interface ModelApiSettings {
  enabled: boolean
  baseUrl: string
  format: ModelApiFormat
  authentication: 'none' | 'token'
  defaultThinking: AgentThinking
}
export interface ModelApiEdit extends ModelApiSettings { token?: string }
export interface ModelApiSave { expectedHash: string | null, connections: Record<ModelApiId, ModelApiEdit> }

export function parseModelApiSave(value: unknown): ModelApiSave {
  const input = record(value, ['expectedHash', 'connections'])
  if (input.expectedHash !== null && (typeof input.expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedHash))) throw new Error('Reload model API settings before saving')
  const connections = record(input.connections, [...modelApiIds])
  for (const id of modelApiIds) {
    const entry = record(connections[id], ['enabled', 'baseUrl', 'format', 'authentication', 'defaultThinking', 'token'])
    if (typeof entry.enabled !== 'boolean' || typeof entry.baseUrl !== 'string' || entry.baseUrl.length > 2048 || !['none', 'token'].includes(String(entry.authentication)) || !agentThinkingLevels.includes(entry.defaultThinking as AgentThinking)) throw new Error('Invalid model API settings')
    if (!(id === 'openai' ? ['chat-completions', 'responses'] : ['messages']).includes(String(entry.format))) throw new Error('Invalid model API format')
    if (entry.token !== undefined && (typeof entry.token !== 'string' || !entry.token || entry.token.length > 4096 || (/[\s\x7F]/.test(entry.token) || [...entry.token].some(character => character.charCodeAt(0) < 32)) || entry.authentication !== 'token')) throw new Error('Enter a valid API token')
  }
  return structuredClone(input) as unknown as ModelApiSave
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error('Invalid model API fields')
  return value as Record<string, unknown>
}
