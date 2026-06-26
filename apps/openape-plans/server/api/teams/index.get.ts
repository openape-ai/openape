import { and, eq, isNull } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { useDb } from '../../database/drizzle'
import { plans, teamMembers, teams } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'

/**
 * GET /api/teams — list teams the caller is a member of.
 *
 * Response: Array<{ id, name, description, role, member_count, plan_count, updated_at }>
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const { include_archived } = getQuery(event) as { include_archived?: string }
  const includeArchived = include_archived === 'true' || include_archived === '1'
  const db = useDb()

  const memberships = await db
    .select({ teamId: teamMembers.teamId, role: teamMembers.role })
    .from(teamMembers)
    .where(eq(teamMembers.userEmail, caller.email))
    .all()

  if (memberships.length === 0) return []

  const ids = memberships.map(m => m.teamId)
  const roleById = new Map(memberships.map(m => [m.teamId, m.role]))

  const teamRows = await db.select().from(teams).all()
  const filtered = teamRows.filter(t => ids.includes(t.id) && (includeArchived || !t.archivedAt))

  return await Promise.all(filtered.map(async (t) => {
    const memberRows = await db.select().from(teamMembers).where(eq(teamMembers.teamId, t.id)).all()
    const planRows = await db
      .select()
      .from(plans)
      .where(and(eq(plans.teamId, t.id), isNull(plans.deletedAt)))
      .all()
    const mostRecent = planRows.reduce((max, p) => (p.updatedAt > max ? p.updatedAt : max), 0)
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      role: roleById.get(t.id) ?? 'viewer',
      member_count: memberRows.length,
      plan_count: planRows.length,
      archived_at: t.archivedAt,
      created_at: t.createdAt,
      updated_at: mostRecent || t.createdAt,
    }
  }))
})
