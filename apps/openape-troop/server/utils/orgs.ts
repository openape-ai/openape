import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { organizations } from '../database/schema'
import { requireOwner, resolveCallerIdentity } from './auth'
import { ownerOf } from './org-access'

/**
 * Resolve `:id` from the route + verify the authenticated owner owns that org.
 * Throws 401 (no session), 404 (no org), or 403 (owner mismatch). Returns the
 * org row for downstream use. Ported from the former openape-org app (B0).
 */
export async function requireOwnedOrg(event: H3Event) {
  const owner = await requireOwner(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'org id required' })

  const db = useDb()
  const rows = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1)
  const org = rows[0]
  if (!org) throw createError({ statusCode: 404, statusMessage: 'organization not found' })
  if (org.ownerEmail.toLowerCase() !== owner.toLowerCase()) {
    throw createError({ statusCode: 403, statusMessage: 'not your organization' })
  }
  return { owner, org }
}

/**
 * READ access to an org: the owner, OR an agent owned by that owner (a
 * member agent reading its own company). Writes still use requireOwnedOrg.
 * For an agent token the real owner is derived from the agent email via
 * `parseAgentEmail`; a human token's sub IS the owner.
 */
export async function requireOrgReadAccess(event: H3Event) {
  const { sub, act } = await resolveCallerIdentity(event)
  const ownerEmail = ownerOf(sub, act)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'org id required' })

  const db = useDb()
  const rows = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1)
  const org = rows[0]
  if (!org) throw createError({ statusCode: 404, statusMessage: 'organization not found' })
  if (org.ownerEmail.toLowerCase() !== ownerEmail.toLowerCase()) {
    throw createError({ statusCode: 403, statusMessage: 'not your organization' })
  }
  return { owner: ownerEmail, caller: sub, org }
}

/** Cryptographically-random org/id, URL-safe. */
export function newId(): string {
  return crypto.randomUUID()
}
