import { and, eq } from 'drizzle-orm'
import { defineEventHandler, readBody } from 'h3'
import { useDb } from '../../database/drizzle'
import {
  companyInvites,
  companyMembers,
  projectInvites,
  projectMembers,
} from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { verifyInviteToken } from '../../utils/invite-jwt'

/**
 * POST /api/invites/accept — join the caller to the company or project the
 * invite token describes (scope auto-detected from the token). Idempotent.
 * Body: { token: string }
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<{ token?: string }>(event)
  const token = body?.token?.trim()
  if (!token) throw createProblemError({ status: 400, title: 'Missing token' })

  const payload = await verifyInviteToken(token)
  if (!payload) throw createProblemError({ status: 410, title: 'Invalid or expired invite' })

  const db = useDb()
  const now = Math.floor(Date.now() / 1000)

  if (payload.scope === 'company') {
    const invite = await db.select().from(companyInvites).where(eq(companyInvites.id, payload.kid)).get()
    if (!invite) throw createProblemError({ status: 410, title: 'Invite no longer exists' })
    if (invite.revokedAt) throw createProblemError({ status: 410, title: 'Invite has been revoked' })
    if (invite.expiresAt <= now) throw createProblemError({ status: 410, title: 'Invite expired' })

    const existing = await db
      .select()
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, invite.companyId), eq(companyMembers.userEmail, caller.email)))
      .get()
    if (existing) {
      return { scope: 'company', company_id: invite.companyId, role: existing.role, already_member: true }
    }
    if (invite.usedCount >= invite.maxUses) {
      throw createProblemError({ status: 410, title: 'Invite has no uses remaining' })
    }
    await db.insert(companyMembers).values({
      companyId: invite.companyId, userEmail: caller.email, role: invite.grantRole, joinedAt: now,
    })
    await db.update(companyInvites).set({ usedCount: invite.usedCount + 1 }).where(eq(companyInvites.id, invite.id)).run()
    return { scope: 'company', company_id: invite.companyId, role: invite.grantRole, already_member: false }
  }

  // project scope
  const invite = await db.select().from(projectInvites).where(eq(projectInvites.id, payload.kid)).get()
  if (!invite) throw createProblemError({ status: 410, title: 'Invite no longer exists' })
  if (invite.revokedAt) throw createProblemError({ status: 410, title: 'Invite has been revoked' })
  if (invite.expiresAt <= now) throw createProblemError({ status: 410, title: 'Invite expired' })

  const existing = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, invite.projectId), eq(projectMembers.userEmail, caller.email)))
    .get()
  if (existing) {
    return { scope: 'project', project_id: invite.projectId, role: existing.role, already_member: true }
  }
  if (invite.usedCount >= invite.maxUses) {
    throw createProblemError({ status: 410, title: 'Invite has no uses remaining' })
  }
  await db.insert(projectMembers).values({
    projectId: invite.projectId, userEmail: caller.email, role: invite.grantRole, joinedAt: now,
  })
  await db.update(projectInvites).set({ usedCount: invite.usedCount + 1 }).where(eq(projectInvites.id, invite.id)).run()
  return { scope: 'project', project_id: invite.projectId, role: invite.grantRole, already_member: false }
})
