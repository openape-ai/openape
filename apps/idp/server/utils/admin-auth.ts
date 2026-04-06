import { timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import type { IdPConfig } from './config'
import { createProblemError } from './problem'

/** Timing-safe string comparison to prevent timing attacks on token validation. */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export function requireManagementToken(event: H3Event, config: IdPConfig): void {
  if (!config.managementToken) {
    throw createProblemError({ status: 501, title: 'Management token not configured' })
  }
  const authHeader = getRequestHeader(event, 'authorization')
  if (!authHeader) {
    throw createProblemError({ status: 401, title: 'Authorization header required' })
  }
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!safeCompare(token, config.managementToken)) {
    throw createProblemError({ status: 403, title: 'Invalid management token' })
  }
}

/** Check if the request carries a valid management token (non-throwing). */
export function hasManagementToken(event: H3Event, config: IdPConfig): boolean {
  if (!config.managementToken) return false
  const authHeader = getRequestHeader(event, 'authorization')
  if (!authHeader) return false
  const token = authHeader.replace(/^Bearer\s+/i, '')
  return safeCompare(token, config.managementToken)
}
