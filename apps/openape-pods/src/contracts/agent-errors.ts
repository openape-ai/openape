import type { AgentCallMetadata } from './agent-metadata'

export const agentErrorCodes = ['invalid_request', 'unsupported_combination', 'proxy_not_configured', 'credential_unavailable', 'proxy_unreachable', 'proxy_unauthorized', 'provider_authentication_failed', 'model_unavailable', 'rate_limited', 'provider_error', 'timeout', 'cancelled', 'invalid_response', 'response_too_large', 'response_truncated', 'model_mismatch', 'unexpected_tool_call'] as const
export type AgentErrorCode = typeof agentErrorCodes[number]
export type AgentPhase = 'resolve' | 'connect' | 'request' | 'read' | 'validate'
export interface AgentErrorDetails { phase: AgentPhase, httpStatus?: number, cause?: string, providerCode?: string, retryAfter?: string }
export interface SafeAgentError { code: AgentErrorCode, message: string, details: AgentErrorDetails }

export class AgentCallError extends Error {
  metadata?: AgentCallMetadata
  constructor(public readonly code: AgentErrorCode, message: string, public readonly details: AgentErrorDetails) { super(message); this.name = 'AgentCallError' }
}

export function serializeSafeError(error: AgentCallError): SafeAgentError { return { code: error.code, message: error.message, details: { ...error.details } } }

export function safeSystemCause(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const source = error as { code?: unknown, cause?: unknown }
  if (typeof source.code === 'string' && /^(?:E[A-Z0-9_]{1,40}|UND_ERR_[A-Z0-9_]{1,40})$/.test(source.code)) return source.code
  return source.cause && source.cause !== error ? safeSystemCause(source.cause) : undefined
}
