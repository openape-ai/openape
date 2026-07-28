import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../database/drizzle'
import { companies, companyInvites, projectInvites, projects } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { verifyInviteToken } from '../../utils/invite-jwt'

/**
 * GET /api/invites/:token — public preview (no auth) so the browser can
 * show "You've been invited to X as <role>" before login redirect.
 */
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')
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
    if (invite.usedCount >= invite.maxUses) throw createProblemError({ status: 410, title: 'Invite has no uses remaining' })
    const company = await db.select().from(companies).where(eq(companies.id, invite.companyId)).get()
    if (!company) throw createProblemError({ status: 410, title: 'Company no longer exists' })
    return {
      scope: 'company', resource_name: company.name, role: invite.grantRole,
      inviter_email: payload.inv, note: invite.note, expires_at: invite.expiresAt,
      uses_remaining: invite.maxUses - invite.usedCount,
    }
  }

  const invite = await db.select().from(projectInvites).where(eq(projectInvites.id, payload.kid)).get()
  if (!invite) throw createProblemError({ status: 410, title: 'Invite no longer exists' })
  if (invite.revokedAt) throw createProblemError({ status: 410, title: 'Invite has been revoked' })
  if (invite.expiresAt <= now) throw createProblemError({ status: 410, title: 'Invite expired' })
  if (invite.usedCount >= invite.maxUses) throw createProblemError({ status: 410, title: 'Invite has no uses remaining' })
  const project = await db.select().from(projects).where(eq(projects.id, invite.projectId)).get()
  if (!project) throw createProblemError({ status: 410, title: 'Project no longer exists' })
  return {
    scope: 'project', resource_name: project.name, role: invite.grantRole,
    inviter_email: payload.inv, note: invite.note, expires_at: invite.expiresAt,
    uses_remaining: invite.maxUses - invite.usedCount,
  }
})
