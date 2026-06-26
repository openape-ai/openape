import { and, eq, isNull } from 'drizzle-orm'
import { defineEventHandler, getQuery, getRouterParam } from 'h3'
import { useDb } from '../../database/drizzle'
import { tasks, teamInvites, teamMembers, teams } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { createProblemError } from '../../utils/problem'

/**
 * DELETE /api/teams/:id — permanently delete a team. Owner only.
 *
 * Refuses with 409 when tasks still exist (not deleted) unless `?force=true`.
 * `force=true` cascade-soft-deletes all tasks in the team before removal.
 * Also removes team_members and any outstanding invites.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'Missing team id' })

  const { force } = getQuery(event) as { force?: string }
  const cascade = force === 'true' || force === '1'

  const db = useDb()
  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, id), eq(teamMembers.userEmail, caller.email)))
    .get()
  if (!membership) throw createProblemError({ status: 403, title: 'Not a team member' })
  if (membership.role !== 'owner') throw createProblemError({ status: 403, title: 'Only owners can delete a team' })

  const aliveTasks = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.teamId, id), isNull(tasks.deletedAt)))
    .all()

  if (aliveTasks.length > 0 && !cascade) {
    throw createProblemError({
      status: 409,
      title: `Team has ${aliveTasks.length} task(s)`,
      detail: 'Pass ?force=true to cascade-soft-delete them, or remove/archive the tasks first.',
    })
  }

  const now = Math.floor(Date.now() / 1000)
  if (aliveTasks.length > 0) {
    await db.update(tasks).set({ deletedAt: now }).where(eq(tasks.teamId, id)).run()
  }
  await db.delete(teamMembers).where(eq(teamMembers.teamId, id)).run()
  await db.delete(teamInvites).where(eq(teamInvites.teamId, id)).run()
  await db.delete(teams).where(eq(teams.id, id)).run()

  return { ok: true, cascade_soft_deleted_tasks: aliveTasks.length }
})
