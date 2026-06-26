import { and, eq, isNull } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../database/drizzle'
import { plans, teamMembers, teams } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { createProblemError } from '../../utils/problem'

/**
 * GET /api/teams/:id — team detail (only if caller is a member).
 *
 * Response: {
 *   id, name, description, created_at,
 *   members: [{ email, role, joined_at }],
 *   plans: [{ id, title, status, owner_email, updated_at, updated_by }]  // most recent first
 * }
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'Missing team id' })

  const db = useDb()

  // Membership check first
  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, id), eq(teamMembers.userEmail, caller.email)))
    .get()
  if (!membership) throw createProblemError({ status: 403, title: 'Not a team member' })

  const team = await db.select().from(teams).where(eq(teams.id, id)).get()
  if (!team) throw createProblemError({ status: 404, title: 'Team not found' })

  const members = await db.select().from(teamMembers).where(eq(teamMembers.teamId, id)).all()
  const planRows = await db
    .select()
    .from(plans)
    .where(and(eq(plans.teamId, id), isNull(plans.deletedAt)))
    .all()
  planRows.sort((a, b) => b.updatedAt - a.updatedAt)

  return {
    id: team.id,
    name: team.name,
    description: team.description,
    created_at: team.createdAt,
    members: members.map(m => ({ email: m.userEmail, role: m.role, joined_at: m.joinedAt })),
    plans: planRows.map(p => ({
      id: p.id,
      title: p.title,
      status: p.status,
      owner_email: p.ownerEmail,
      updated_at: p.updatedAt,
      updated_by: p.updatedBy,
    })),
  }
})
