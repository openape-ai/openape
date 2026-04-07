import { timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { getHeader } from 'h3'
import { useEvent, useRuntimeConfig } from 'nitropack/runtime'
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

function hasManagementToken(event: H3Event): boolean {
  const config = useRuntimeConfig()
  const expected = config.openapeIdp.managementToken as string
  if (!expected) return false
  const auth = getHeader(event, 'Authorization')
  if (!auth) return false
  const token = auth.replace(RE_BEARER_PREFIX, '')
  // Timing-safe comparison to prevent timing attacks
  const tokenBuf = Buffer.from(token)
  const expectedBuf = Buffer.from(expected)
  if (tokenBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(tokenBuf, expectedBuf)
}

export async function requireAuth(event: H3Event): Promise<string> {
  if (hasManagementToken(event)) return '_management_'

  const session = await getAppSession(event)
  if (!session.data.userId) {
    throw createProblemError({ status: 401, title: 'Authentication required' })
  }
  return session.data.userId as string
}

export async function requireAdmin(event: H3Event): Promise<string> {
  if (hasManagementToken(event)) return '_management_'

  const session = await getAppSession(event)
  if (!session.data.userId) {
    throw createProblemError({ status: 401, title: 'Authentication required' })
  }
  const email = session.data.userId as string
  if (isAdmin(email)) {
    return email
  }
  throw createProblemError({ status: 403, title: 'Admin access required' })
}
