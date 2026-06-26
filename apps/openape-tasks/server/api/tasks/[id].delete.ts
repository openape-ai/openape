import { and, eq, isNull } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { useDb } from '../../database/drizzle'
import { tasks, teamMembers } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { createProblemError } from '../../utils/problem'

/**
 * DELETE /api/tasks/:id — soft delete. Viewers cannot delete.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'Missing task id' })

  const db = useDb()
  const task = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)))
    .get()
  if (!task) throw createProblemError({ status: 404, title: 'Task not found' })

  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, task.teamId), eq(teamMembers.userEmail, caller.email)))
    .get()
  if (!membership) throw createProblemError({ status: 403, title: 'Not a team member' })
  if (membership.role === 'viewer') throw createProblemError({ status: 403, title: 'Viewers cannot delete tasks' })

  const now = Math.floor(Date.now() / 1000)
  await db
    .update(tasks)
    .set({ deletedAt: now, updatedAt: now, updatedBy: caller.email })
    .where(eq(tasks.id, id))
    .run()

  setResponseStatus(event, 204)
  return ''
})
