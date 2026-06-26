import { and, eq, isNull } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../database/drizzle'
import { teamInvites, teamMembers } from '../../../database/schema'
import { requireCaller } from '../../../utils/require-auth'
import { createProblemError } from '../../../utils/problem'

/**
 * GET /api/teams/:id/invites — list non-revoked invites for a team.
 * Owner/editor only. Caller-sensitive: does not return raw tokens, only ids,
 * so a revoked invite cannot be silently re-shared from the UI.
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
  if (membership.role === 'viewer') throw createProblemError({ status: 403, title: 'Viewers cannot view invites' })

  const now = Math.floor(Date.now() / 1000)
  const rows = await db
    .select()
    .from(teamInvites)
    .where(and(eq(teamInvites.teamId, teamId), isNull(teamInvites.revokedAt)))
    .all()

  return rows
    .filter(r => r.expiresAt > now && r.usedCount < r.maxUses)
    .map(r => ({
      id: r.id,
      created_by: r.createdBy,
      note: r.note,
      max_uses: r.maxUses,
      used_count: r.usedCount,
      expires_at: r.expiresAt,
      created_at: r.createdAt,
    }))
})
