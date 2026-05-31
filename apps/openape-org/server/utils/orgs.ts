import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { organizations } from '../database/schema'
import { requireOwner } from './auth'

/**
 * Resolve `:id` from the route + verify the authenticated owner is the
 * `ownerEmail` of that org. Throws 401 if no session, 404 if no org,
 * 403 if owner mismatch. Returns the full org row for downstream use.
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

/** Cryptographically-random ID, URL-safe. */
export function newId(): string {
  return crypto.randomUUID()
}
