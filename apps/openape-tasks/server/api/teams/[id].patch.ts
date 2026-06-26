import { and, eq, isNull } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { useDb } from '../../database/drizzle'
import { tasks, teamMembers, teams } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { createProblemError } from '../../utils/problem'
import { type Lane, effectiveLaneId, resolveLanes, validateLanes } from '../../utils/lanes'

/**
 * PATCH /api/teams/:id — rename, edit description, bind to an org, or set board
 * lanes. Owner-only.
 *
 * Body: { name?, description? | null, org_id? | null, lanes? }
 *   lanes: array of { id?, name, status: open|doing|done } (≥1 open + ≥1 done).
 *   Removing a lane reassigns its tasks to the first lane of the same bucket.
 * Response: the updated team (subset of list shape, no counts recomputed).
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'Missing team id' })

  const body = await readBody<{ name?: string, description?: string | null, org_id?: string | null, lanes?: unknown }>(event)
  const patch: { name?: string, description?: string | null, orgId?: string | null, lanes?: string } = {}

  let nextLanes: Lane[] | null = null
  if (body?.lanes !== undefined) {
    try {
      nextLanes = validateLanes(body.lanes)
    }
    catch (err) {
      throw createProblemError({ status: 400, title: err instanceof Error ? err.message : 'invalid lanes' })
    }
    patch.lanes = JSON.stringify(nextLanes)
  }

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
  if (body?.org_id !== undefined) {
    if (body.org_id === null || body.org_id === '') {
      patch.orgId = null
    }
    else {
      const orgId = body.org_id.trim()
      if (orgId.length > 64) throw createProblemError({ status: 400, title: 'org_id must be ≤ 64 chars' })
      patch.orgId = orgId
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

  // When lanes change, move any task whose lane no longer exists to the first
  // lane of its status bucket so nothing is orphaned off-board.
  if (nextLanes) {
    const validIds = new Set(nextLanes.map(l => l.id))
    const teamTasks = await db
      .select({ id: tasks.id, status: tasks.status, laneId: tasks.laneId })
      .from(tasks)
      .where(and(eq(tasks.teamId, id), isNull(tasks.deletedAt)))
      .all()
    for (const t of teamTasks) {
      if (t.laneId && validIds.has(t.laneId)) continue
      const target = effectiveLaneId(nextLanes, t.status, null)
      if (target !== t.laneId) {
        await db.update(tasks).set({ laneId: target }).where(eq(tasks.id, t.id)).run()
      }
    }
  }

  const updated = await db.select().from(teams).where(eq(teams.id, id)).get()
  if (!updated) throw createProblemError({ status: 404, title: 'Team vanished mid-update' })
  return {
    id: updated.id,
    name: updated.name,
    description: updated.description,
    org_id: updated.orgId,
    role: membership.role,
    archived_at: updated.archivedAt,
    created_at: updated.createdAt,
    lanes: resolveLanes(updated.lanes),
  }
})
