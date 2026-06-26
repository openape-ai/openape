import { eq } from 'drizzle-orm'
import { defineEventHandler, getRequestURL, getRouterParam, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../database/drizzle'
import { projectInvites, projects } from '../../../database/schema'
import { requireCaller } from '../../../utils/require-auth'
import { createProblemError } from '../../../utils/problem'
import { parseDuration, signInviteToken } from '../../../utils/invite-jwt'
import { resolveProjectContext } from '../../../utils/rbac'

const ROLES = new Set(['manager', 'member'])

/**
 * POST /api/projects/:id/invite — shareable project invite.
 * Company owner or project manager. Body: { role:'manager'|'member', ... }
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const projectId = getRouterParam(event, 'id')
  if (!projectId) throw createProblemError({ status: 400, title: 'Missing project id' })

  const db = useDb()
  const project = await db.select().from(projects).where(eq(projects.id, projectId)).get()
  if (!project) throw createProblemError({ status: 404, title: 'Project not found' })

  const ctx = await resolveProjectContext(db, projectId, caller.email)
  const allowed = ctx && (ctx.companyRole === 'owner' || ctx.projectRole === 'manager')
  if (!allowed) throw createProblemError({ status: 403, title: 'Company owner or project manager only' })

  const body = await readBody<{ role?: string, max_uses?: number, expires_in?: string, note?: string }>(event)
  const grantRole = body?.role
  if (!grantRole || !ROLES.has(grantRole)) {
    throw createProblemError({ status: 400, title: 'role must be manager|member' })
  }
  const maxUses = typeof body?.max_uses === 'number' ? Math.floor(body.max_uses) : 5
  if (maxUses < 1 || maxUses > 100) throw createProblemError({ status: 400, title: 'max_uses must be 1–100' })
  const ttl = parseDuration(body?.expires_in, 24 * 7)
  if (ttl < 60 || ttl > 90 * 86400) throw createProblemError({ status: 400, title: 'expires_in must be 1m–90d' })
  const note = body?.note?.trim() || null

  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + ttl
  const id = ulid()

  const token = await signInviteToken({
    inviteId: id, scope: 'project', resourceId: projectId, role: grantRole,
    inviterEmail: caller.email, expiresAt,
  })

  await db.insert(projectInvites).values({
    id, projectId, createdBy: caller.email, note, grantRole: grantRole as 'manager' | 'member',
    maxUses, usedCount: 0, expiresAt, revokedAt: null, createdAt: now,
  })

  const origin = new URL('/', getRequestURL(event)).origin
  setResponseStatus(event, 201)
  return { id, url: `${origin}/invite?t=${token}`, token, role: grantRole, expires_at: expiresAt, max_uses: maxUses, note }
})
