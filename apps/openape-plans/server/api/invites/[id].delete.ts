import { and, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../database/drizzle'
import { teamInvites, teamMembers } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { createProblemError } from '../../utils/problem'

/**
 * DELETE /api/invites/:id — revoke an invite. Only owners/editors of the
 * invite's team can revoke. Idempotent: already-revoked returns ok.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'Missing invite id' })

  const db = useDb()
  const invite = await db.select().from(teamInvites).where(eq(teamInvites.id, id)).get()
  if (!invite) throw createProblemError({ status: 404, title: 'Invite not found' })

  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, invite.teamId), eq(teamMembers.userEmail, caller.email)))
    .get()
  if (!membership) throw createProblemError({ status: 403, title: 'Not a team member' })
  if (membership.role === 'viewer') throw createProblemError({ status: 403, title: 'Viewers cannot revoke invites' })

  if (!invite.revokedAt) {
    const now = Math.floor(Date.now() / 1000)
    await db.update(teamInvites).set({ revokedAt: now }).where(eq(teamInvites.id, id)).run()
  }
  return { ok: true }
})
