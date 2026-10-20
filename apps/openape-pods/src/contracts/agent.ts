import { AgentCallError } from './agent-errors'

export const agentBackends = ['native', 'proxy'] as const
export const agentProviders = ['claude', 'codex'] as const
export const agentModelSizes = ['small', 'medium', 'large', 'xlarge'] as const
export const agentThinkingLevels = ['low', 'medium', 'high', 'xhigh'] as const
export type AgentBackend = typeof agentBackends[number]
export type AgentProvider = typeof agentProviders[number]
export type AgentModelSize = typeof agentModelSizes[number]
export type AgentThinking = typeof agentThinkingLevels[number]
export const agentModelSizeLabels = { small: 'Small', medium: 'Medium', large: 'Large', xlarge: 'Extra Large' } as const
export const agentThinkingLabels = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High' } as const

interface AgentRequestBase { prompt: string, timeoutSeconds: number }
export interface NativeAgentRequest extends AgentRequestBase { backend?: 'native', provider?: 'codex', tools: [] | ['ape_shell'] }
export interface ProxyAgentRequest extends AgentRequestBase { backend: 'proxy', provider: AgentProvider, modelSize: AgentModelSize, thinking?: AgentThinking, tools: [] }
export type AgentRequest = NativeAgentRequest | ProxyAgentRequest
export const defaultAgentTimeoutSeconds = 120
export const maxAgentTimeoutSeconds = 900
/** Agent calls pause a run's script time limit, up to this total per run so unawaited calls cannot extend it indefinitely. */
export const maxAgentPauseMs = 2 * maxAgentTimeoutSeconds * 1000

function invalid(message: string, unsupported = false): never { throw new AgentCallError(unsupported ? 'unsupported_combination' : 'invalid_request', message, { phase: 'resolve' }) }

export function parseAgentRequest(value: unknown): AgentRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['prompt', 'tools', 'timeoutSeconds', 'backend', 'provider', 'modelSize', 'thinking'].includes(key))) invalid('Invalid agent request')
  const request = value as Record<string, unknown>
  if (typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 128 * 1024) invalid('Invalid agent prompt')
  const timeoutSeconds = request.timeoutSeconds ?? defaultAgentTimeoutSeconds
  if (!Number.isInteger(timeoutSeconds) || (timeoutSeconds as number) < 30 || (timeoutSeconds as number) > maxAgentTimeoutSeconds) invalid(`Agent timeoutSeconds must be an integer from 30 to ${maxAgentTimeoutSeconds}`)
  if (request.tools !== undefined && (!Array.isArray(request.tools) || request.tools.length > 1 || request.tools.some(tool => tool !== 'ape_shell'))) invalid('Agent tools must be [] or ["ape_shell"]')
  const common = { prompt: request.prompt, timeoutSeconds: timeoutSeconds as number }
  if (request.backend === 'proxy') {
    if (!agentProviders.includes(request.provider as AgentProvider)) invalid('Proxy agent provider must be claude or codex')
    if (!agentModelSizes.includes(request.modelSize as AgentModelSize)) invalid('Proxy agent modelSize must be small, medium, large or xlarge')
    if ('thinking' in request && !agentThinkingLevels.includes(request.thinking as AgentThinking)) invalid('Proxy agent thinking must be low, medium, high or xhigh')
    if (Array.isArray(request.tools) && request.tools.length) invalid('Proxy agent calls do not support ape_shell', true)
    return { ...common, backend: 'proxy', provider: request.provider as AgentProvider, modelSize: request.modelSize as AgentModelSize, ...('thinking' in request ? { thinking: request.thinking as AgentThinking } : {}), tools: [] }
  }
  if ('backend' in request && request.backend !== 'native') invalid('Agent backend must be native or proxy')
  if ('provider' in request && request.provider !== 'codex') invalid('Native agent calls require the codex provider', true)
  if ('modelSize' in request || 'thinking' in request) invalid('Native agent calls do not accept modelSize or thinking', true)
  return { ...common, ...('backend' in request ? { backend: 'native' as const } : {}), ...('provider' in request ? { provider: 'codex' as const } : {}), tools: Array.isArray(request.tools) && request.tools.length ? ['ape_shell'] : [] }
}
