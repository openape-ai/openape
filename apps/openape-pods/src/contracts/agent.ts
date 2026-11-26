import { AgentCallError } from './agent-errors'

/** Backends a script can select; 'native' remains only in recorded history. */
export const agentBackends = ['proxy'] as const
export const agentProviders = ['claude', 'codex'] as const
export const agentModelSizes = ['small', 'medium', 'large', 'xlarge'] as const
export const agentThinkingLevels = ['low', 'medium', 'high', 'xhigh'] as const
export type AgentBackend = 'native' | typeof agentBackends[number]
export type AgentProvider = typeof agentProviders[number]
export type AgentModelSize = typeof agentModelSizes[number]
export type AgentThinking = typeof agentThinkingLevels[number]
export const agentModelSizeLabels = { small: 'Small', medium: 'Medium', large: 'Large', xlarge: 'Extra Large' } as const
export const agentThinkingLabels = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High' } as const

interface AgentRequestBase { prompt: string, timeoutSeconds: number }
export interface ProxyAgentRequest extends AgentRequestBase { backend: 'proxy', provider: AgentProvider, modelSize: AgentModelSize, thinking?: AgentThinking, tools: [] }
export type AgentRequest = ProxyAgentRequest
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
  if (Array.isArray(request.tools) && request.tools.includes('ape_shell')) invalid('The ape_shell agent tool was removed; pass tools: [] and call context.tools.invoke directly', true)
  if (request.tools !== undefined && (!Array.isArray(request.tools) || request.tools.length)) invalid('Agent tools must be []')
  const common = { prompt: request.prompt, timeoutSeconds: timeoutSeconds as number }
  if (request.backend !== 'proxy') invalid('agent.run requires backend:"proxy" with provider ("claude" or "codex") and modelSize ("small", "medium", "large" or "xlarge"); the native Codex backend was removed', true)
  if (!agentProviders.includes(request.provider as AgentProvider)) invalid('Proxy agent provider must be claude or codex')
  if (!agentModelSizes.includes(request.modelSize as AgentModelSize)) invalid('Proxy agent modelSize must be small, medium, large or xlarge')
  if ('thinking' in request && !agentThinkingLevels.includes(request.thinking as AgentThinking)) invalid('Proxy agent thinking must be low, medium, high or xhigh')
  return { ...common, backend: 'proxy', provider: request.provider as AgentProvider, modelSize: request.modelSize as AgentModelSize, ...('thinking' in request ? { thinking: request.thinking as AgentThinking } : {}), tools: [] }
}
