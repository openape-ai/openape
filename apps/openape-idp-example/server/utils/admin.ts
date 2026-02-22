import type { H3Event } from 'h3'

function getAdminEmails(): string[] {
  const config = useRuntimeConfig()
  const raw = config.openapeAdminEmails as string
  if (!raw) return []
  return raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
}

export function isAdmin(email: string): boolean {
  return getAdminEmails().includes(email.toLowerCase())
}

export async function requireAuth(event: H3Event): Promise<string> {
  const session = await getAppSession(event)
  if (!session.data.userId) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
  return session.data.userId as string
}

export async function requireAdmin(event: H3Event): Promise<string> {
  const session = await getAppSession(event)
  if (!session.data.userId) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
  const email = session.data.userId as string
  if (session.data.isSuperAdmin === true || isAdmin(email)) {
    return email
  }
  throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
}
