import { and, eq } from 'drizzle-orm'
import { defineEventHandler, readBody } from 'h3'
import { useDb } from '../../database/drizzle'
import { teamInvites, teamMembers } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { createProblemError } from '../../utils/problem'
import { verifyInviteToken } from '../../utils/invite-jwt'

/**
 * POST /api/invites/accept — authenticated endpoint that joins the caller
 * to the team described by the invite token.
 *
 * Body: { token: string }
 * Response: { team_id, team_role }
 *
 * Idempotent: if caller is already a member, just returns the team info.
 * On first acceptance, increments the invite's used_count.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<{ token?: string }>(event)
  const token = body?.token?.trim()
  if (!token) throw createProblemError({ status: 400, title: 'Missing token' })

  const payload = await verifyInviteToken(token)
  if (!payload) throw createProblemError({ status: 410, title: 'Invalid or expired invite' })

  const db = useDb()
  const invite = await db.select().from(teamInvites).where(eq(teamInvites.id, payload.kid)).get()
  if (!invite) throw createProblemError({ status: 410, title: 'Invite no longer exists' })
  if (invite.revokedAt) throw createProblemError({ status: 410, title: 'Invite has been revoked' })

  const now = Math.floor(Date.now() / 1000)
  if (invite.expiresAt <= now) throw createProblemError({ status: 410, title: 'Invite expired' })

  const existing = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, invite.teamId), eq(teamMembers.userEmail, caller.email)))
    .get()

  if (existing) {
    return { team_id: invite.teamId, team_role: existing.role, already_member: true }
  }

  if (invite.usedCount >= invite.maxUses) {
    throw createProblemError({ status: 410, title: 'Invite has no uses remaining' })
  }

  await db.insert(teamMembers).values({
    teamId: invite.teamId,
    userEmail: caller.email,
    role: 'editor',
    joinedAt: now,
  })
  await db
    .update(teamInvites)
    .set({ usedCount: invite.usedCount + 1 })
    .where(eq(teamInvites.id, invite.id))
    .run()

  return { team_id: invite.teamId, team_role: 'editor', already_member: false }
})
