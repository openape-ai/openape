import { and, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../../database/drizzle'
import { teamMembers } from '../../../../database/schema'
import { requireCaller } from '../../../../utils/require-auth'
import { createProblemError } from '../../../../utils/problem'

/**
 * DELETE /api/teams/:id/members/:email — remove a member. Owner-only,
 * except that any member may remove themselves (leave).
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const teamId = getRouterParam(event, 'id')
  const targetEmail = decodeURIComponent(getRouterParam(event, 'email') ?? '')
  if (!teamId || !targetEmail) throw createProblemError({ status: 400, title: 'Missing team id or email' })

  const db = useDb()
  const callerMembership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userEmail, caller.email)))
    .get()
  if (!callerMembership) throw createProblemError({ status: 403, title: 'Not a team member' })

  const selfRemove = caller.email === targetEmail
  if (!selfRemove && callerMembership.role !== 'owner') {
    throw createProblemError({ status: 403, title: 'Only owners can remove other members' })
  }

  await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userEmail, targetEmail)))
    .run()

  return { ok: true }
})
