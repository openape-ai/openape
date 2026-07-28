import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { organizations } from '../../database/schema'
import { requireCockpitAgent } from './auth'

// The serving Operator may manage automations only for orgs owned by its OWN
// identity (the worker polls troop as the owner). Scoping — not an allowlist — is
// the boundary: an agent can only ever touch its own owner's orgs. Returns the
// agent's (= owner's) email.
export async function requireAgentOrg(event: H3Event, orgId: string): Promise<string> {
  const agent = await requireCockpitAgent(event)
  if (!orgId) throw createError({ statusCode: 400, statusMessage: 'orgId required' })
  const [org] = await useDb().select().from(organizations).where(and(eq(organizations.id, orgId), eq(organizations.ownerEmail, agent)))
  if (!org) throw createError({ statusCode: 404, statusMessage: 'unknown org' })
  return agent
}
