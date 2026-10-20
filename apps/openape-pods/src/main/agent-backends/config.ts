import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { agentModelSizes, agentProviders, agentThinkingLevels } from '../../contracts/agent'
import type { AgentProvider, AgentThinking, ProxyAgentRequest } from '../../contracts/agent'
import { AgentCallError } from '../../contracts/agent-errors'
import type { AgentWireThinking } from '../../contracts/agent-metadata'
import type { AgentBackendConfig, ProxyModelConfig, ProxySnapshot } from './types'

function invalid(message: string): never { throw new AgentCallError('proxy_not_configured', message, { phase: 'resolve' }) }
function record(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid(`Invalid proxy configuration: ${label}`)
  return value as Record<string, unknown>
}
function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-z0-9][\w.:@+-]{0,159}$/i.test(value)) invalid(`Invalid proxy configuration: ${label}`)
  return value
}
function boolean(value: unknown, label: string): boolean { if (typeof value !== 'boolean') invalid(`Invalid proxy configuration: ${label}`); return value }
function thinking(value: unknown): AgentThinking { if (!agentThinkingLevels.includes(value as AgentThinking)) invalid('Invalid proxy thinking level'); return value as AgentThinking }

export function validateProxyBaseUrl(value: unknown): string {
  if (typeof value !== 'string') invalid('Proxy base URL is required')
  let url: URL
  try { url = new URL(value) }
  catch { return invalid('Invalid proxy base URL') }
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol) || url.pathname.replace(/\/$/, '') !== '/v1') invalid('Proxy base URL requires the /v1 path without credentials, query or fragment')
  if (url.protocol === 'http:' && !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) invalid('Remote proxy connections require HTTPS')
  return `${url.origin}/v1`
}

function translation(value: unknown, provider: AgentProvider, level: AgentThinking, outputLimit: number): AgentWireThinking {
  const wire = record(value, ['type', 'budget_tokens', 'effort', 'reasoning_effort'], 'thinking translation')
  if (provider === 'codex' && Object.keys(wire).length === 1 && wire.reasoning_effort === level) return { reasoning_effort: level }
  if (provider === 'claude' && Object.keys(wire).length === 2 && wire.type === 'adaptive' && wire.effort === level) return { type: 'adaptive', effort: level }
  if (provider === 'claude' && Object.keys(wire).length === 2 && wire.type === 'enabled' && Number.isSafeInteger(wire.budget_tokens) && (wire.budget_tokens as number) >= 1024 && (wire.budget_tokens as number) < outputLimit) return { type: 'enabled', budget_tokens: wire.budget_tokens as number }
  return invalid('Invalid proxy thinking translation; levels cannot be substituted and budgets must fit the output limit')
}

function model(value: unknown, provider: AgentProvider): ProxyModelConfig {
  const entry = record(value, ['enabled', 'modelId', 'protocol', 'defaultThinking', 'thinking', 'outputLimit', 'capabilityEvidenceVersion'], 'model mapping')
  const protocol = provider === 'claude' ? 'messages' : 'chat-completions'
  if (entry.protocol !== protocol) invalid(`Proxy ${provider} requires ${protocol}`)
  if (!Number.isSafeInteger(entry.outputLimit) || (entry.outputLimit as number) < 1 || (entry.outputLimit as number) > 128000) invalid('Invalid proxy output limit')
  const levels = record(entry.thinking, [...agentThinkingLevels], 'thinking levels')
  const parsed = {} as ProxyModelConfig['thinking']
  for (const level of agentThinkingLevels) {
    const policy = record(levels[level], ['enabled', 'translation'], 'thinking policy')
    parsed[level] = { enabled: boolean(policy.enabled, 'thinking enabled'), translation: translation(policy.translation, provider, level, entry.outputLimit as number) }
  }
  const wireTypes = new Set(Object.values(parsed).map(policy => 'type' in policy.translation ? policy.translation.type : 'reasoning_effort'))
  if (wireTypes.size !== 1) invalid('One model cannot mix thinking translation modes')
  return { enabled: boolean(entry.enabled, 'model enabled'), modelId: identifier(entry.modelId, 'model ID'), protocol, defaultThinking: thinking(entry.defaultThinking), thinking: parsed, outputLimit: entry.outputLimit as number, capabilityEvidenceVersion: identifier(entry.capabilityEvidenceVersion, 'capability evidence version') }
}

export function parseAgentBackendConfig(value: unknown): AgentBackendConfig {
  const config = record(value, ['schemaVersion', 'revision', 'proxy'], 'root')
  if (config.schemaVersion !== 1) invalid('Unsupported agent backend configuration schemaVersion')
  const proxy = record(config.proxy, ['enabled', 'baseUrl', 'keyFile', 'keyField', 'models'], 'proxy')
  if (typeof proxy.keyFile !== 'string' || !isAbsolute(proxy.keyFile) || proxy.keyFile.length > 4096 || /[\0\r\n\\"]/.test(proxy.keyFile)) invalid('Proxy keyFile must be an absolute path')
  if (proxy.keyField !== 'api_key') invalid('Proxy keyField must be api_key')
  const entries = record(proxy.models, [...agentProviders], 'providers')
  const models = {} as AgentBackendConfig['proxy']['models']
  for (const provider of agentProviders) {
    const sizes = record(entries[provider], [...agentModelSizes], 'model classes')
    models[provider] = {}
    for (const size of agentModelSizes) {
      if (sizes[size] !== undefined) models[provider][size] = model(sizes[size], provider)
    }
  }
  return deepFreeze({ schemaVersion: 1, revision: identifier(config.revision, 'revision'), proxy: { enabled: boolean(proxy.enabled, 'proxy enabled'), baseUrl: validateProxyBaseUrl(proxy.baseUrl), keyFile: proxy.keyFile, keyField: 'api_key', models } })
}

export function configurationHash(config: AgentBackendConfig): string { return createHash('sha256').update(JSON.stringify(config)).digest('hex') }
export function resolveProxyRequest(config: AgentBackendConfig, request: ProxyAgentRequest): ProxySnapshot {
  if (!config.proxy.enabled) throw new AgentCallError('proxy_not_configured', 'Proxy agent backend is disabled', { phase: 'resolve' })
  const model = config.proxy.models[request.provider][request.modelSize]
  if (!model || !model.enabled) throw new AgentCallError('model_unavailable', 'The requested proxy model mapping is missing or disabled', { phase: 'resolve' })
  const effectiveThinking = request.thinking ?? model.defaultThinking
  const policy = model.thinking[effectiveThinking]
  if (!policy.enabled) throw new AgentCallError('unsupported_combination', 'The requested proxy model and thinking combination is disabled', { phase: 'resolve' })
  return deepFreeze({ revision: config.revision, hash: configurationHash(config), baseUrl: config.proxy.baseUrl, keyFile: config.proxy.keyFile, model, effectiveThinking, wireThinking: policy.translation })
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value) }
  return value
}
