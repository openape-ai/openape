import { and, eq, isNull } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { useDb } from '../../database/drizzle'
import { plans, teamMembers } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { createProblemError } from '../../utils/problem'

type PlanStatus = 'draft' | 'active' | 'done' | 'archived'
const VALID_STATUS = new Set<PlanStatus>(['draft', 'active', 'done', 'archived'])

/**
 * PATCH /api/plans/:id — update a plan. Viewers cannot edit.
 *
 * Body: { title?: string, body_md?: string, status?: PlanStatus }
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'Missing plan id' })

  const body = await readBody<{ title?: string, body_md?: string, status?: string }>(event)
  const patch: { title?: string, bodyMd?: string, status?: PlanStatus } = {}
  if (body.title !== undefined) {
    const t = body.title.trim()
    if (!t || t.length > 200) throw createProblemError({ status: 400, title: 'title must be 1–200 chars' })
    patch.title = t
  }
  if (body.body_md !== undefined) patch.bodyMd = body.body_md
  if (body.status !== undefined) {
    if (!VALID_STATUS.has(body.status as PlanStatus)) {
      throw createProblemError({ status: 400, title: 'invalid status' })
    }
    patch.status = body.status as PlanStatus
  }
  if (Object.keys(patch).length === 0) {
    throw createProblemError({ status: 400, title: 'No fields to update' })
  }

  const db = useDb()
  const plan = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, id), isNull(plans.deletedAt)))
    .get()
  if (!plan) throw createProblemError({ status: 404, title: 'Plan not found' })

  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, plan.teamId), eq(teamMembers.userEmail, caller.email)))
    .get()
  if (!membership) throw createProblemError({ status: 403, title: 'Not a team member' })
  if (membership.role === 'viewer') throw createProblemError({ status: 403, title: 'Viewers cannot edit plans' })

  const now = Math.floor(Date.now() / 1000)
  await db
    .update(plans)
    .set({ ...patch, updatedAt: now, updatedBy: caller.email })
    .where(eq(plans.id, id))
    .run()

  const updated = await db.select().from(plans).where(eq(plans.id, id)).get()
  if (!updated) throw createProblemError({ status: 500, title: 'Plan disappeared after update' })

  return {
    id: updated.id,
    team_id: updated.teamId,
    title: updated.title,
    body_md: updated.bodyMd,
    status: updated.status,
    owner_email: updated.ownerEmail,
    created_at: updated.createdAt,
    updated_at: updated.updatedAt,
    updated_by: updated.updatedBy,
  }
})
