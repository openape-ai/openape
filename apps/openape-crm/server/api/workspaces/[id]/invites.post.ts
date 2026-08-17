import { randomBytes } from 'node:crypto'
import { defineEventHandler, getRequestURL, getRouterParam, readBody, setResponseStatus } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { ulid } from 'ulid'
import { useDb } from '../../../database/drizzle'
import { workspaceInvites } from '../../../database/schema'
import { createProblemError } from '../../../utils/problem'
import { requireRole } from '../../../utils/workspace-access'

const DAY_MS = 86_400_000

/**
 * POST /api/workspaces/:id/invites — Einladungslink erzeugen (ab `manager`).
 * Body: { role?: 'manager'|'member', max_uses?: number, days?: number }
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const workspaceId = getRouterParam(event, 'id')!
  const body = await readBody<{ role?: string, max_uses?: number, days?: number, note?: string }>(event)
  const db = useDb()

  await requireRole(db, workspaceId, caller.email, 'manager')

  const role = body?.role ?? 'member'
  if (role !== 'manager' && role !== 'member') {
    throw createProblemError({ status: 400, title: 'role must be manager or member' })
  }

  const maxUses = body?.max_uses ?? 5
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100) {
    throw createProblemError({ status: 400, title: 'max_uses must be 1–100' })
  }

  const days = body?.days ?? 7
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw createProblemError({ status: 400, title: 'days must be 1–90' })
  }

  const token = randomBytes(24).toString('base64url')
  const now = Date.now()
  const id = ulid()

  await db.insert(workspaceInvites).values({
    id,
    token,
    workspaceId,
    createdBy: caller.email,
    note: body?.note?.slice(0, 200) ?? null,
    grantRole: role,
    maxUses,
    usedCount: 0,
    expiresAt: now + days * DAY_MS,
    createdAt: now,
  })

  const base = (useRuntimeConfig().publicUrl as string) || getRequestURL(event).origin
  setResponseStatus(event, 201)
  return { id, url: `${base}/invite?token=${token}`, role, max_uses: maxUses, expires_at: now + days * DAY_MS }
})
