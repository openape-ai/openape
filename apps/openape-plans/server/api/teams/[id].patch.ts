import { and, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { useDb } from '../../database/drizzle'
import { teamMembers, teams } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { createProblemError } from '../../utils/problem'

/**
 * PATCH /api/teams/:id — rename or edit description. Owner-only.
 *
 * Body: { name?: string, description?: string | null }
 * Response: the updated team with member/plan counts (same shape as list).
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'Missing team id' })

  const body = await readBody<{ name?: string, description?: string | null }>(event)
  const patch: { name?: string, description?: string | null } = {}
  if (typeof body?.name === 'string') {
    const name = body.name.trim()
    if (!name || name.length > 120) throw createProblemError({ status: 400, title: 'name must be 1–120 chars' })
    patch.name = name
  }
  if (body?.description !== undefined) {
    if (body.description === null || body.description === '') {
      patch.description = null
    }
    else {
      const desc = body.description.trim()
      if (desc.length > 500) throw createProblemError({ status: 400, title: 'description must be ≤ 500 chars' })
      patch.description = desc
    }
  }
  if (Object.keys(patch).length === 0) throw createProblemError({ status: 400, title: 'No fields to update' })

  const db = useDb()
  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, id), eq(teamMembers.userEmail, caller.email)))
    .get()
  if (!membership) throw createProblemError({ status: 403, title: 'Not a team member' })
  if (membership.role !== 'owner') throw createProblemError({ status: 403, title: 'Only owners can edit a team' })

  await db.update(teams).set(patch).where(eq(teams.id, id)).run()

  const updated = await db.select().from(teams).where(eq(teams.id, id)).get()
  if (!updated) throw createProblemError({ status: 404, title: 'Team vanished mid-update' })
  return {
    id: updated.id,
    name: updated.name,
    description: updated.description,
    role: membership.role,
    archived_at: updated.archivedAt,
    created_at: updated.createdAt,
  }
})
