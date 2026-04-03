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
  if (!config.openapeIdp.managementToken) return false
  const auth = getHeader(event, 'Authorization')
  if (!auth) return false
  const token = auth.replace(RE_BEARER_PREFIX, '')
  return token === config.openapeIdp.managementToken
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
