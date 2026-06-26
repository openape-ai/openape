import { and, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../database/drizzle'
import { teamMembers, teams } from '../../../database/schema'
import { requireCaller } from '../../../utils/require-auth'
import { createProblemError } from '../../../utils/problem'

/**
 * POST /api/teams/:id/archive — soft-archive a team (sets archived_at).
 * Owner only. Idempotent.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'Missing team id' })

  const db = useDb()
  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, id), eq(teamMembers.userEmail, caller.email)))
    .get()
  if (!membership) throw createProblemError({ status: 403, title: 'Not a team member' })
  if (membership.role !== 'owner') throw createProblemError({ status: 403, title: 'Only owners can archive a team' })

  const now = Math.floor(Date.now() / 1000)
  await db.update(teams).set({ archivedAt: now }).where(eq(teams.id, id)).run()
  return { ok: true, archived_at: now }
})
