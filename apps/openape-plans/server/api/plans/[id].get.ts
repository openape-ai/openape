import { and, eq, isNull } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../database/drizzle'
import { plans, teamMembers } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { createProblemError } from '../../utils/problem'

/**
 * GET /api/plans/:id — full plan including body_md. Membership-checked.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'Missing plan id' })

  const db = useDb()
  const plan = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, id), isNull(plans.deletedAt)))
    .get()
  if (!plan) throw createProblemError({ status: 404, title: 'Plan not found' })

  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, plan.teamId), eq(teamMembers.userEmail, caller.email)))
    .get()
  if (!membership) throw createProblemError({ status: 403, title: 'Not a team member' })

  return {
    id: plan.id,
    team_id: plan.teamId,
    title: plan.title,
    body_md: plan.bodyMd,
    status: plan.status,
    owner_email: plan.ownerEmail,
    created_at: plan.createdAt,
    updated_at: plan.updatedAt,
    updated_by: plan.updatedBy,
    caller_role: membership.role,
  }
})
