import { isAbsolute } from 'node:path'
import { agentModelSizes, agentProviders, agentThinkingLevels } from '../../contracts/agent'
import type { AgentProvider, ProxyAgentRequest } from '../../contracts/agent'
import { AgentCallError } from '../../contracts/agent-errors'
import { modelApiIds } from '../../contracts/model-api'
import type { ModelApiId } from '../../contracts/model-api'
import { boolean, configurationHash, identifier, model, parseAgentBackendConfig, record, thinking, validateProxyBaseUrl } from './config'
import { latestModel, modelFamilies, modelVersion } from './families'
import type { CredentialReference, FamilyPolicy, ModelApiConfig, ModelApiConnection, ModelCatalog, ProxySnapshot } from './types'

export const providerConnection: Record<AgentProvider, ModelApiId> = { codex: 'openai', claude: 'anthropic' }
function invalid(message: string): never { throw new AgentCallError('proxy_not_configured', message, { phase: 'resolve' }) }
function credential(value: unknown): CredentialReference | undefined {
  if (value === undefined) return undefined
  const ref = record(value, ['type', 'id', 'path'], 'credential reference')
  if (ref.type === 'managed' && Object.keys(ref).length === 2 && typeof ref.id === 'string' && /^[a-f0-9-]{36}$/.test(ref.id)) return { type: 'managed', id: ref.id }
  if (ref.type === 'external' && Object.keys(ref).length === 2 && typeof ref.path === 'string' && isAbsolute(ref.path) && ref.path.length <= 4096 && !/[\0\r\n\\"]/.test(ref.path)) return { type: 'external', path: ref.path }
  return invalid('Invalid model API credential reference')
}
export function defaultModelApiConfig(): ModelApiConfig {
  const models = {} as ModelApiConfig['models']
  for (const provider of agentProviders) {
    models[provider] = {}
    for (const size of agentModelSizes) {
      const budget = provider === 'claude' && size === 'small'
      models[provider][size] = { family: modelFamilies[provider][size], enabled: true, defaultThinking: 'medium', outputLimit: budget ? 40960 : 16384, capabilityEvidenceVersion: 'family-contract-1', thinking: Object.fromEntries(agentThinkingLevels.map(level => [level, { enabled: true, translation: provider === 'codex' ? { reasoning_effort: level } : budget ? { type: 'enabled', budget_tokens: { low: 1024, medium: 8192, high: 24576, xhigh: 32768 }[level] } : { type: 'adaptive', effort: level } }])) as FamilyPolicy['thinking'] }
    }
  }
  const connection = (id: ModelApiId): ModelApiConnection => ({ id, enabled: false, baseUrl: 'http://127.0.0.1:8317/v1', format: id === 'openai' ? 'chat-completions' : 'messages', authentication: 'none', defaultThinking: 'medium' })
  return { schemaVersion: 2, revision: 'initial', resolverVersion: '1', connections: { openai: connection('openai'), anthropic: connection('anthropic') }, models }
}
function migrate(value: unknown): ModelApiConfig {
  const legacy = parseAgentBackendConfig(value); const config = defaultModelApiConfig()
  config.revision = legacy.revision
  for (const id of modelApiIds) config.connections[id] = { ...config.connections[id], enabled: legacy.proxy.enabled, baseUrl: legacy.proxy.baseUrl, authentication: 'token', credential: { type: 'external', path: legacy.proxy.keyFile } }
  for (const provider of agentProviders) {
    config.models[provider] = {}
    for (const size of agentModelSizes) {
      const entry = legacy.proxy.models[provider][size]
      if (!entry) continue
      const family = modelFamilies[provider][size]
      if (!modelVersion(entry.modelId, provider, family)) invalid('Legacy model mapping has no recognized family; review the API configuration')
      const { modelId: _id, protocol: _protocol, ...policy } = entry
      config.models[provider][size] = { ...policy, family }
    }
  }
  return config
}
export function parseModelApiConfig(value: unknown): ModelApiConfig {
  if (value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 1) return migrate(value)
  const raw = record(value, ['schemaVersion', 'revision', 'resolverVersion', 'connections', 'models'], 'model API root')
  if (raw.schemaVersion !== 2 || raw.resolverVersion !== '1') invalid('Unsupported model API configuration version')
  const config = defaultModelApiConfig(); config.revision = identifier(raw.revision, 'revision')
  const connections = record(raw.connections, [...modelApiIds], 'connections')
  for (const id of modelApiIds) {
    const item = record(connections[id], ['id', 'enabled', 'baseUrl', 'format', 'authentication', 'credential', 'defaultThinking'], 'connection')
    if (item.id !== id || !(id === 'openai' ? ['chat-completions', 'responses'] : ['messages']).includes(String(item.format)) || !['none', 'token'].includes(String(item.authentication))) invalid('Invalid API connection format or authentication')
    const ref = credential(item.credential)
    if (item.authentication === 'none' && ref) invalid('Unauthenticated connections cannot reference credentials')
    config.connections[id] = { id, enabled: boolean(item.enabled, 'enabled'), baseUrl: validateProxyBaseUrl(item.baseUrl), format: item.format as ModelApiConnection['format'], authentication: item.authentication as 'none' | 'token', ...(ref ? { credential: ref } : {}), defaultThinking: thinking(item.defaultThinking) }
  }
  const providers = record(raw.models, [...agentProviders], 'families')
  for (const provider of agentProviders) {
    const sizes = record(providers[provider], [...agentModelSizes], 'model classes'); config.models[provider] = {}
    for (const size of agentModelSizes) {
      if (sizes[size] === undefined) continue
      const entry = record(sizes[size], ['enabled', 'family', 'defaultThinking', 'thinking', 'outputLimit', 'capabilityEvidenceVersion'], 'family policy')
      if (entry.family !== modelFamilies[provider][size]) invalid('Model family assignment is not supported')
      const { family, ...policy } = entry
      const parsed = model({ ...policy, modelId: family, protocol: provider === 'claude' ? 'messages' : 'chat-completions' }, provider)
      const { modelId: _id, protocol: _protocol, ...validated } = parsed
      config.models[provider][size] = { ...validated, family: family as string }
    }
  }
  return config
}
export function validateModelSelection(config: ModelApiConfig, request: ProxyAgentRequest): void {
  const connection = config.connections[providerConnection[request.provider]]
  if (!connection.enabled) throw new AgentCallError('proxy_not_configured', 'The model API connection is disabled', { phase: 'resolve' })
  const policy = config.models[request.provider][request.modelSize]
  if (!policy?.enabled) throw new AgentCallError('model_unavailable', 'The requested model family is missing or disabled', { phase: 'resolve' })
  if (!policy.thinking[request.thinking ?? policy.defaultThinking].enabled) throw new AgentCallError('unsupported_combination', 'The requested thinking level is disabled', { phase: 'resolve' })
}
export function resolveLatestRequest(config: ModelApiConfig, request: ProxyAgentRequest, catalog: ModelCatalog): ProxySnapshot {
  validateModelSelection(config, request)
  const connection = config.connections[providerConnection[request.provider]]
  const policy = config.models[request.provider][request.modelSize]
  if (!policy) return invalid('Missing model family')
  const selected = latestModel(catalog.entries, request.provider, request.modelSize)
  const effectiveThinking = request.thinking ?? policy.defaultThinking
  const wireThinking = policy.thinking[effectiveThinking].translation
  if (request.provider === 'claude' && (!Number.isSafeInteger(selected.entry.max_tokens) || Number(selected.entry.max_tokens) < policy.outputLimit)) throw new AgentCallError('unsupported_combination', 'The newest Claude model has no compatible declared output limit', { phase: 'resolve' })
  return { revision: config.revision, hash: configurationHash(config), baseUrl: connection.baseUrl, keyFile: '', connectionId: connection.id, authentication: connection.authentication, model: { ...policy, modelId: selected.entry.id, protocol: connection.format }, effectiveThinking, wireThinking, catalog: { hash: catalog.hash, checkedAt: catalog.checkedAt }, family: selected.family, version: selected.version }
}
