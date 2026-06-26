import { and, eq } from 'drizzle-orm'
import { defineEventHandler, getRequestURL, getRouterParam, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../database/drizzle'
import { teamInvites, teamMembers } from '../../../database/schema'
import { requireCaller } from '../../../utils/require-auth'
import { createProblemError } from '../../../utils/problem'
import { parseDuration, signInviteToken } from '../../../utils/invite-jwt'

/**
 * POST /api/teams/:id/invites — create a shareable invite link.
 *
 * Body: { max_uses?: number (1-100, default 5), expires_in?: string ("7d"|"24h"|"30m", default "7d"), note?: string }
 * Response: { id, url, token, expires_at, max_uses, note }
 *
 * Owner/editor only. Viewers cannot create invites.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const teamId = getRouterParam(event, 'id')
  if (!teamId) throw createProblemError({ status: 400, title: 'Missing team id' })

  const body = await readBody<{ max_uses?: number, expires_in?: string, note?: string }>(event)
  const maxUses = typeof body?.max_uses === 'number' ? Math.floor(body.max_uses) : 5
  if (maxUses < 1 || maxUses > 100) throw createProblemError({ status: 400, title: 'max_uses must be 1–100' })

  const ttlSeconds = parseDuration(body?.expires_in, 24 * 7)
  if (ttlSeconds < 60 || ttlSeconds > 90 * 86400) {
    throw createProblemError({ status: 400, title: 'expires_in must be between 1m and 90d' })
  }
  const note = body?.note?.trim() || null
  if (note && note.length > 200) throw createProblemError({ status: 400, title: 'note must be ≤ 200 chars' })

  const db = useDb()
  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userEmail, caller.email)))
    .get()
  if (!membership) throw createProblemError({ status: 403, title: 'Not a team member' })
  if (membership.role === 'viewer') throw createProblemError({ status: 403, title: 'Viewers cannot create invites' })

  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + ttlSeconds
  const id = ulid()

  const token = await signInviteToken({
    inviteId: id,
    teamId,
    inviterEmail: caller.email,
    expiresAt,
  })

  await db.insert(teamInvites).values({
    id,
    teamId,
    createdBy: caller.email,
    note,
    maxUses,
    usedCount: 0,
    expiresAt,
    revokedAt: null,
    createdAt: now,
  })

  const origin = new URL('/', getRequestURL(event)).origin
  const url = `${origin}/invite?t=${token}`

  setResponseStatus(event, 201)
  return {
    id,
    url,
    token,
    expires_at: expiresAt,
    max_uses: maxUses,
    note,
  }
})
