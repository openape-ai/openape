import { and, eq, isNull } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../database/drizzle'
import { plans, teamMembers } from '../../../database/schema'
import { requireCaller } from '../../../utils/require-auth'
import { createProblemError } from '../../../utils/problem'

/**
 * GET /api/teams/:id/plans — list plans in a team (most recently updated first).
 * Only team members may list. Soft-deleted plans are excluded.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const teamId = getRouterParam(event, 'id')
  if (!teamId) throw createProblemError({ status: 400, title: 'Missing team id' })

  const db = useDb()
  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userEmail, caller.email)))
    .get()
  if (!membership) throw createProblemError({ status: 403, title: 'Not a team member' })

  const rows = await db
    .select()
    .from(plans)
    .where(and(eq(plans.teamId, teamId), isNull(plans.deletedAt)))
    .all()
  rows.sort((a, b) => b.updatedAt - a.updatedAt)

  return rows.map(p => ({
    id: p.id,
    team_id: p.teamId,
    title: p.title,
    status: p.status,
    owner_email: p.ownerEmail,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    updated_by: p.updatedBy,
  }))
})
