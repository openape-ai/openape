import { and, eq, isNull } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../database/drizzle'
import { tasks, teamMembers, teams } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { resolveLanes } from '../../utils/lanes'

/**
 * GET /api/teams/:id — team detail (only if caller is a member).
 *
 * Response: {
 *   id, name, description, created_at,
 *   members: [{ email, role, joined_at }],
 *   task_count: { open, doing, done, archived, total }
 * }
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'Missing team id' })

  const db = useDb()

  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, id), eq(teamMembers.userEmail, caller.email)))
    .get()
  if (!membership) throw createProblemError({ status: 403, title: 'Not a team member' })

  const team = await db.select().from(teams).where(eq(teams.id, id)).get()
  if (!team) throw createProblemError({ status: 404, title: 'Team not found' })

  const members = await db.select().from(teamMembers).where(eq(teamMembers.teamId, id)).all()
  const taskRows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.teamId, id), isNull(tasks.deletedAt)))
    .all()

  const counts = { open: 0, doing: 0, done: 0, archived: 0, total: taskRows.length }
  for (const t of taskRows) counts[t.status]++

  return {
    id: team.id,
    name: team.name,
    description: team.description,
    org_id: team.orgId,
    archived_at: team.archivedAt,
    created_at: team.createdAt,
    lanes: resolveLanes(team.lanes),
    members: members.map(m => ({ email: m.userEmail, role: m.role, joined_at: m.joinedAt })),
    task_count: counts,
  }
})
