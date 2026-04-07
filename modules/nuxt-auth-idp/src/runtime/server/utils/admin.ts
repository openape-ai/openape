import { timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { getHeader } from 'h3'
import { useEvent, useRuntimeConfig } from 'nitropack/runtime'
import { tryBearerAuth } from './agent-auth'
import { getAppSession } from './session'
import { createProblemError } from './problem'

function getAdminEmails(): string[] {
  try {
    const event = useEvent()
    if (event?.context?.openapeAdminEmails) {
      const emails = event.context.openapeAdminEmails as string[]
      return emails.map(e => e.trim().toLowerCase()).filter(Boolean)
    }
  }
  catch {}
  const config = useRuntimeConfig()
  const raw = config.openapeIdp.adminEmails as string
  if (!raw)
    return []
  return raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
}

export function isAdmin(email: string): boolean {
  return getAdminEmails().includes(email.toLowerCase())
}

const RE_BEARER_PREFIX = /^Bearer\s+/i

/**
 * Check management token.
 * Returns 'valid' | 'invalid' | 'none'.
 * - 'valid': token matches
 * - 'invalid': Authorization header present but token does not match
 * - 'none': no Authorization header
 */
function checkManagementToken(event: H3Event): 'valid' | 'invalid' | 'none' {
  const config = useRuntimeConfig()
  const expected = config.openapeIdp.managementToken as string
  const auth = getHeader(event, 'Authorization')
  if (!auth) return 'none'
  if (!expected) return 'invalid'
  const token = auth.replace(RE_BEARER_PREFIX, '')
  // Timing-safe comparison to prevent timing attacks
  const tokenBuf = Buffer.from(token)
  const expectedBuf = Buffer.from(expected)
  if (tokenBuf.length !== expectedBuf.length) return 'invalid'
  return timingSafeEqual(tokenBuf, expectedBuf) ? 'valid' : 'invalid'
}

export async function requireAuth(event: H3Event): Promise<string> {
  const tokenCheck = checkManagementToken(event)
  if (tokenCheck === 'valid') return '_management_'

  // If a Bearer token is present but not the management token, try JWT auth
  if (tokenCheck === 'invalid') {
    const bearerPayload = await tryBearerAuth(event)
    if (bearerPayload) return bearerPayload.sub
    throw createProblemError({ status: 403, title: 'Invalid token' })
  }

  let session
  try {
    session = await getAppSession(event)
  }
  catch {
    throw createProblemError({ status: 401, title: 'Authentication required' })
  }
  if (!session.data.userId) {
    throw createProblemError({ status: 401, title: 'Authentication required' })
  }
  return session.data.userId as string
}

export async function requireAdmin(event: H3Event): Promise<string> {
  const tokenCheck = checkManagementToken(event)
  if (tokenCheck === 'valid') return '_management_'
  if (tokenCheck === 'invalid') {
    throw createProblemError({ status: 403, title: 'Invalid management token' })
  }

  let session
  try {
    session = await getAppSession(event)
  }
  catch {
    throw createProblemError({ status: 401, title: 'Authentication required' })
  }
  if (!session.data.userId) {
    throw createProblemError({ status: 401, title: 'Authentication required' })
  }
  const email = session.data.userId as string
  if (isAdmin(email)) {
    return email
  }
  throw createProblemError({ status: 403, title: 'Admin access required' })
}
