import { and, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../database/drizzle'
import { plans, teamMembers } from '../../../database/schema'
import { requireCaller } from '../../../utils/require-auth'
import { createProblemError } from '../../../utils/problem'

type PlanStatus = 'draft' | 'active' | 'done' | 'archived'
const VALID_STATUS = new Set<PlanStatus>(['draft', 'active', 'done', 'archived'])

/**
 * POST /api/teams/:id/plans — create a plan in a team the caller is a member of.
 * Viewer role may not create plans.
 *
 * Body: { title: string, body_md?: string, status?: PlanStatus }
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const teamId = getRouterParam(event, 'id')
  if (!teamId) throw createProblemError({ status: 400, title: 'Missing team id' })

  const body = await readBody<{ title?: string, body_md?: string, status?: string }>(event)
  const title = body?.title?.trim()
  if (!title || title.length > 200) {
    throw createProblemError({ status: 400, title: 'title must be 1–200 chars' })
  }
  const bodyMd = body?.body_md ?? ''
  const status = (body?.status ?? 'draft') as PlanStatus
  if (!VALID_STATUS.has(status)) {
    throw createProblemError({ status: 400, title: 'invalid status' })
  }

  const db = useDb()
  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userEmail, caller.email)))
    .get()
  if (!membership) throw createProblemError({ status: 403, title: 'Not a team member' })
  if (membership.role === 'viewer') {
    throw createProblemError({ status: 403, title: 'Viewers cannot create plans' })
  }

  const now = Math.floor(Date.now() / 1000)
  const id = ulid()
  await db.insert(plans).values({
    id,
    teamId,
    title,
    bodyMd,
    status,
    ownerEmail: caller.email,
    createdAt: now,
    updatedAt: now,
    updatedBy: caller.email,
  })

  setResponseStatus(event, 201)
  return {
    id,
    team_id: teamId,
    title,
    body_md: bodyMd,
    status,
    owner_email: caller.email,
    created_at: now,
    updated_at: now,
    updated_by: caller.email,
  }
})
