import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { organizations } from '../../database/schema'
import { cockpitOwner } from './auth'

// Resolve the caller and assert they own the org in the route; returns both.
export async function requireOwnedOrg(event: H3Event): Promise<{ owner: string, orgId: string }> {
  const owner = await cockpitOwner(event)
  const orgId = getRouterParam(event, 'orgId')
  if (!orgId) throw createError({ statusCode: 400, statusMessage: 'orgId required' })
  const [org] = await useDb().select().from(organizations).where(and(eq(organizations.id, orgId), eq(organizations.ownerEmail, owner)))
  if (!org) throw createError({ statusCode: 404, statusMessage: 'unknown org' })
  return { owner, orgId }
}
