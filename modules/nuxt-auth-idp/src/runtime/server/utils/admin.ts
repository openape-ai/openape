import { timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { getHeader } from 'h3'
import { useEvent, useRuntimeConfig } from 'nitropack/runtime'
import { tryBearerAuth } from './agent-auth'
import { getAppSession } from './session'
import { createProblemError } from './problem'

/**
 * Pluggable admin-status resolver. Consuming apps can register one of
 * these on `event.context.openapeAdminResolver` (typically from a
 * Nitro plugin) to replace the default email-allowlist check with
 * something like a DNS-rooted DDISA admin flow or a DB-backed roles
 * table. Returning `true` grants admin access for the duration of
 * this request only — no caching across requests at this layer.
 *
 * `openapeRootAdminResolver` is for a stricter "root" tier that
 * MUST NOT be overridable from app data — used to gate operator
 * promotion / demotion. Apps that don't have a root tier can omit it
 * and `requireRootAdmin` will fall through to `requireAdmin`.
 */
export type AdminResolver = (event: H3Event, email: string) => boolean | Promise<boolean>

declare module 'h3' {
  interface H3EventContext {
    openapeAdminEmails?: string[]
    openapeAdminResolver?: AdminResolver
    openapeRootAdminResolver?: AdminResolver
  }
}

function getAdminEmails(): string[] {
  try {
    const event = useEvent()
    if (event?.context?.openapeAdminEmails) {
      const emails = event.context.openapeAdminEmails
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

async function requireAdminOfTier(
  event: H3Event,
  tier: 'admin' | 'root',
): Promise<string> {
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

  // Resolver takes precedence over the legacy email allowlist when
  // an app has registered one. For the 'root' tier we deliberately
  // do NOT fall back to the email allowlist — root status must be
  // gated by something stronger than env-config (e.g. a DNS-rooted
  // claim secret). Apps that don't ship a root resolver fall through
  // to the standard admin check, which is the safe loud failure mode.
  const resolver = tier === 'root'
    ? event.context.openapeRootAdminResolver
    : event.context.openapeAdminResolver
  if (resolver) {
    if (await resolver(event, email)) return email
    throw createProblemError({
      status: 403,
      title: tier === 'root' ? 'Root admin access required' : 'Admin access required',
    })
  }

  if (tier === 'admin' && isAdmin(email)) return email

  throw createProblemError({
    status: 403,
    title: tier === 'root' ? 'Root admin access required' : 'Admin access required',
  })
}

export async function requireAdmin(event: H3Event): Promise<string> {
  return requireAdminOfTier(event, 'admin')
}

/**
 * Strict variant for actions that MUST be gated by something stronger
 * than the email allowlist — e.g. promoting other users to operator,
 * rotating signing keys. Apps register a resolver via
 * `event.context.openapeRootAdminResolver`; if none is registered the
 * call fails closed with 403 (no fallback to env-config).
 */
export async function requireRootAdmin(event: H3Event): Promise<string> {
  return requireAdminOfTier(event, 'root')
}
