import type { H3Event } from 'h3'

function getAdminEmails(): string[] {
  const config = useRuntimeConfig()
  const raw = config.openapeAdminEmails as string
  if (!raw)
    return []
  return raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
}

export function isAdmin(email: string): boolean {
  return getAdminEmails().includes(email.toLowerCase())
}

/**
 * Check if the request carries a valid management token.
 * Returns true if the Bearer token matches NUXT_MANAGEMENT_TOKEN.
 */
function hasManagementToken(event: H3Event): boolean {
  const config = useRuntimeConfig()
  if (!config.managementToken) return false
  const auth = getHeader(event, 'Authorization')
  if (!auth) return false
  const token = auth.replace(/^Bearer\s+/i, '')
  return token === config.managementToken
}

/**
 * Require authenticated user (session-based).
 * Returns the user's email.
 */
export async function requireAuth(event: H3Event): Promise<string> {
  // Management token grants admin-level access
  if (hasManagementToken(event)) return '_management_'

  const session = await getAppSession(event)
  if (!session.data.userId) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
  return session.data.userId as string
}

/**
 * Require admin access. Accepts either:
 * 1. Management API token (via Authorization: Bearer header)
 * 2. Session-based login with admin email or super-admin flag
 */
export async function requireAdmin(event: H3Event): Promise<string> {
  // Management token bypasses session checks
  if (hasManagementToken(event)) return '_management_'

  const session = await getAppSession(event)
  if (!session.data.userId) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
  const email = session.data.userId as string
  if (isAdmin(email)) {
    return email
  }
  throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
}
