import { and, eq, isNull } from 'drizzle-orm'
import { defineEventHandler, getQuery, getRouterParam } from 'h3'
import { useDb } from '../../../database/drizzle'
import { tasks, teamMembers, teams } from '../../../database/schema'
import { requireCaller } from '../../../utils/require-auth'
import { createProblemError } from '../../../utils/problem'
import { serializeTask, VALID_STATUS, type TaskStatus } from '../../../utils/task-shape'
import { effectiveLaneId, laneById, resolveLanes } from '../../../utils/lanes'

/**
 * GET /api/teams/:id/tasks — list tasks in a team.
 *
 * Query:
 *   status=open,doing,done,archived  (comma-separated; default: open,doing,done)
 *   lane=<id|name>                   (optional; filter to one board lane)
 *
 * Ordering: sort_order asc, created_at asc (stable).
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const teamId = getRouterParam(event, 'id')
  if (!teamId) throw createProblemError({ status: 400, title: 'Missing team id' })

  const db = useDb()
  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userEmail, caller.email)))
    .get()
  if (!membership) throw createProblemError({ status: 403, title: 'Not a team member' })

  const { status, lane } = getQuery(event) as { status?: string, lane?: string }
  const requested = status
    ? status.split(',').map(s => s.trim()).filter((s): s is TaskStatus => VALID_STATUS.has(s as TaskStatus))
    : (['open', 'doing', 'done'] as TaskStatus[])

  const rows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.teamId, teamId), isNull(tasks.deletedAt)))
    .all()

  let filtered = rows.filter(r => requested.includes(r.status))

  if (lane) {
    const team = await db.select({ lanes: teams.lanes }).from(teams).where(eq(teams.id, teamId)).get()
    const lanes = resolveLanes(team?.lanes)
    const target = laneById(lanes, lane)
    if (!target) throw createProblemError({ status: 400, title: `Lane "${lane}" not found in this team` })
    filtered = filtered.filter(r => effectiveLaneId(lanes, r.status, r.laneId) === target.id)
  }

  filtered.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return a.createdAt - b.createdAt
  })

  return filtered.map(serializeTask)
})
