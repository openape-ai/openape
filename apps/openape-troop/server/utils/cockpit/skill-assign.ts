import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { useDb } from '../../database/drizzle'
import { cockpitAgents } from '../../database/schema'

// A skill's assignedTo targets must each be 'ceo' or a cockpit_agent id of the
// SAME org — no dangling/foreign ids. Returns the cleaned list or throws 400.
export async function validateAssignedTo(owner: string, orgId: string, raw: unknown): Promise<string[]> {
  if (!Array.isArray(raw)) throw createError({ statusCode: 400, statusMessage: 'assignedTo must be an array' })
  const targets = [...new Set(raw.filter(t => typeof t === 'string' && t.trim()).map(t => (t as string).trim()))]
  const agentIds = targets.filter(t => t !== 'ceo')
  if (agentIds.length) {
    const rows = await useDb().select({ id: cockpitAgents.id }).from(cockpitAgents).where(and(eq(cockpitAgents.ownerEmail, owner), eq(cockpitAgents.orgId, orgId)))
    const valid = new Set(rows.map(r => r.id))
    const bad = agentIds.find(id => !valid.has(id))
    if (bad) throw createError({ statusCode: 400, statusMessage: `unknown agent in assignedTo: ${bad}` })
  }
  return targets
}

// Owner-level (library) variant: a target is 'ceo' or a cockpit_agent id the owner
// owns in ANY of their orgs — a library skill spans companies.
export async function validateOwnerAssignedTo(owner: string, raw: unknown): Promise<string[]> {
  if (!Array.isArray(raw)) throw createError({ statusCode: 400, statusMessage: 'assignedTo must be an array' })
  const targets = [...new Set(raw.filter(t => typeof t === 'string' && t.trim()).map(t => (t as string).trim()))]
  const agentIds = targets.filter(t => t !== 'ceo')
  if (agentIds.length) {
    const rows = await useDb().select({ id: cockpitAgents.id }).from(cockpitAgents).where(eq(cockpitAgents.ownerEmail, owner))
    const valid = new Set(rows.map(r => r.id))
    const bad = agentIds.find(id => !valid.has(id))
    if (bad) throw createError({ statusCode: 400, statusMessage: `unknown agent in assignedTo: ${bad}` })
  }
  return targets
}
