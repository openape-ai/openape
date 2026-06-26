import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../database/drizzle'
import { teamInvites, teams } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { verifyInviteToken } from '../../utils/invite-jwt'

/**
 * GET /api/invites/:token — public verify endpoint (no auth). Returns a
 * preview so an unauthenticated browser can show "You've been invited to
 * Team X by Y" before triggering the login redirect. Returns 410 Gone for
 * expired, revoked, or used-up invites so the UI can distinguish from 404.
 */
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')
  if (!token) throw createProblemError({ status: 400, title: 'Missing token' })

  const payload = await verifyInviteToken(token)
  if (!payload) throw createProblemError({ status: 410, title: 'Invalid or expired invite' })

  const db = useDb()
  const invite = await db.select().from(teamInvites).where(eq(teamInvites.id, payload.kid)).get()
  if (!invite) throw createProblemError({ status: 410, title: 'Invite no longer exists' })
  if (invite.revokedAt) throw createProblemError({ status: 410, title: 'Invite has been revoked' })

  const now = Math.floor(Date.now() / 1000)
  if (invite.expiresAt <= now) throw createProblemError({ status: 410, title: 'Invite expired' })
  if (invite.usedCount >= invite.maxUses) throw createProblemError({ status: 410, title: 'Invite has no uses remaining' })

  const team = await db.select().from(teams).where(eq(teams.id, invite.teamId)).get()
  if (!team) throw createProblemError({ status: 410, title: 'Team no longer exists' })

  return {
    team_id: team.id,
    team_name: team.name,
    team_description: team.description,
    inviter_email: payload.inv,
    note: invite.note,
    expires_at: invite.expiresAt,
    uses_remaining: invite.maxUses - invite.usedCount,
  }
})
