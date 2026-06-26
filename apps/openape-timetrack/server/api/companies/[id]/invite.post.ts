import { defineEventHandler, getRequestURL, getRouterParam, readBody, setResponseStatus } from 'h3'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { useDb } from '../../../database/drizzle'
import { companies, companyInvites } from '../../../database/schema'
import { requireCaller } from '../../../utils/require-auth'
import { createProblemError } from '../../../utils/problem'
import { parseDuration, signInviteToken } from '../../../utils/invite-jwt'
import { resolveCompanyRole } from '../../../utils/rbac'

const ROLES = new Set(['owner', 'manager', 'member'])

/**
 * POST /api/companies/:id/invite — shareable company invite. Owner only.
 * Body: { role: 'owner'|'manager'|'member', max_uses?, expires_in?, note? }
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const companyId = getRouterParam(event, 'id')
  if (!companyId) throw createProblemError({ status: 400, title: 'Missing company id' })

  const db = useDb()
  const company = await db.select().from(companies).where(eq(companies.id, companyId)).get()
  if (!company) throw createProblemError({ status: 404, title: 'Company not found' })

  const role = await resolveCompanyRole(db, companyId, caller.email)
  if (role !== 'owner') throw createProblemError({ status: 403, title: 'Owner only' })

  const body = await readBody<{ role?: string, max_uses?: number, expires_in?: string, note?: string }>(event)
  const grantRole = body?.role
  if (!grantRole || !ROLES.has(grantRole)) {
    throw createProblemError({ status: 400, title: 'role must be owner|manager|member' })
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
    inviteId: id, scope: 'company', resourceId: companyId, role: grantRole,
    inviterEmail: caller.email, expiresAt,
  })

  await db.insert(companyInvites).values({
    id, companyId, createdBy: caller.email, note, grantRole: grantRole as 'owner' | 'manager' | 'member',
    maxUses, usedCount: 0, expiresAt, revokedAt: null, createdAt: now,
  })

  const origin = new URL('/', getRequestURL(event)).origin
  setResponseStatus(event, 201)
  return { id, url: `${origin}/invite?t=${token}`, token, role: grantRole, expires_at: expiresAt, max_uses: maxUses, note }
})
