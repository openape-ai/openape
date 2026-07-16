import { and, eq, or } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { cockpitAgents, cockpitSkills, memory, objectives, organizations } from '../../database/schema'
import { buildSystemPrompt } from './system-prompt'
import { resolveOrgSkills } from './skill-scope'

// Assemble the Operator's grounding for one (owner, org): org facts, objectives,
// delegation team, memory, resolved skills → the system prompt the brain runs
// under. Returns null if the org isn't owned by `owner`. Shared by the chat
// endpoint and the proactive trigger evaluator so the two can never drift.
export async function buildOrgSystemPrompt(owner: string, orgId: string): Promise<string | null> {
  const db = useDb()
  const [org] = await db.select().from(organizations).where(and(eq(organizations.id, orgId), eq(organizations.ownerEmail, owner)))
  if (!org) return null
  const objs = await db.select().from(objectives).where(eq(objectives.orgId, orgId))
  const teamRows = await db.select().from(cockpitAgents).where(and(eq(cockpitAgents.ownerEmail, owner), eq(cockpitAgents.orgId, orgId)))
  const team = teamRows.filter(t => t.enabled).map(t => ({ id: t.id, role: t.role, label: t.label, duties: t.duties, tools: t.tools }))
  const memRows = await db.select().from(memory).where(and(eq(memory.orgId, orgId), eq(memory.ownerEmail, owner)))
  const mem = memRows.map(m => ({ id: m.id, title: m.title, body: m.body, mode: m.mode, scope: m.scope, targetId: m.targetId }))
  const teamIds = new Set(teamRows.map(t => t.id))
  const skillRows = await db.select().from(cockpitSkills).where(and(eq(cockpitSkills.ownerEmail, owner), or(eq(cockpitSkills.orgId, orgId), eq(cockpitSkills.orgId, ''))))
  const skills = resolveOrgSkills(skillRows, orgId, teamIds)
  return buildSystemPrompt(org, objs, owner, team, mem, skills)
}
