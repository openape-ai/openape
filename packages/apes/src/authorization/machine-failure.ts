import type { OpenApeExecutionFailure } from '@openape/core'
import { ApiError } from '../http.js'
import { AuthorizationRefusedError, AuthorizationTimeoutError } from './program.js'

const permissionStates = new Set(['missing', 'pending', 'denied', 'revoked', 'expired', 'used'])
const transientStatuses = new Set([408, 429, 500, 502, 503, 504])
const networkCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET'])

export function executionFailure(error: unknown): OpenApeExecutionFailure | undefined {
  if (error instanceof AuthorizationTimeoutError) return { kind: 'permission', state: 'pending', grantId: error.grantId }
  if (error instanceof AuthorizationRefusedError && permissionStates.has(error.state)) return { kind: 'permission', state: error.state as 'missing' | 'pending' | 'denied' | 'revoked' | 'expired' | 'used', grantId: error.grantId }
  if (error instanceof ApiError) {
    if (transientStatuses.has(error.statusCode)) return { kind: 'infrastructure', phase: 'authorization', retryAfterMs: Math.min(60000, Math.max(0, Math.ceil(error.retryAfterMs))), status: error.statusCode, detail: `HTTP ${error.statusCode}` }
    if (error.statusCode === 404 && error.problemDetails?.type === 'https://openape.org/errors/grant_not_found') return { kind: 'permission', state: 'missing' }
    return undefined
  }
  const fault = error instanceof Error ? error as Error & { code?: string, cause?: { code?: string } } : null
  const code = fault?.code ?? fault?.cause?.code
  if (fault?.name === 'TimeoutError' || (code && networkCodes.has(code))) return { kind: 'infrastructure', phase: 'authorization', retryAfterMs: 0 }
  return undefined
}
