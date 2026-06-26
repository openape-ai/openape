import { and, eq, isNull } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../database/drizzle'
import { plans, teamMembers } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { createProblemError } from '../../utils/problem'

/**
 * DELETE /api/plans/:id — soft-delete (sets deleted_at). Owner of the plan or
 * team owner may delete. Idempotent: already-deleted plans return 404.
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

  const isPlanOwner = plan.ownerEmail === caller.email
  const isTeamOwner = membership.role === 'owner'
  if (!isPlanOwner && !isTeamOwner) {
    throw createProblemError({ status: 403, title: 'Only the plan owner or a team owner can delete' })
  }

  const now = Math.floor(Date.now() / 1000)
  await db.update(plans).set({ deletedAt: now }).where(eq(plans.id, id)).run()

  return { ok: true }
})
