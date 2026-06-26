import { and, eq, inArray, isNull } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../database/drizzle'
import { tasks, teamMembers, teams } from '../../../database/schema'
import { requireCaller } from '../../../utils/require-auth'
import { createProblemError } from '../../../utils/problem'
import { laneById, resolveLanes } from '../../../utils/lanes'
import {
  serializeTask,
  VALID_PRIORITY,
  VALID_STATUS,
  type TaskPriority,
  type TaskStatus,
} from '../../../utils/task-shape'

interface CreateBody {
  title?: string
  notes?: string
  status?: string
  priority?: string
  due_at?: number | null
  assignee_email?: string | null
  lane_id?: string | null
  remind_at?: number | null
  reminder_max?: number
  context_url?: string | null
  context_summary?: string | null
  dedup_key?: string | null
}

/**
 * POST /api/teams/:id/tasks — create a task. Viewer role may not create.
 *
 * Body: { title (required), notes?, status?, priority?, due_at?, assignee_email? }
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const teamId = getRouterParam(event, 'id')
  if (!teamId) throw createProblemError({ status: 400, title: 'Missing team id' })

  const body = await readBody<CreateBody>(event)
  const title = body?.title?.trim()
  if (!title || title.length > 200) {
    throw createProblemError({ status: 400, title: 'title must be 1–200 chars' })
  }

  const status = (body?.status ?? 'open') as TaskStatus
  if (!VALID_STATUS.has(status)) {
    throw createProblemError({ status: 400, title: 'invalid status' })
  }

  let priority: TaskPriority | null = null
  if (body?.priority != null && body.priority !== '') {
    if (!VALID_PRIORITY.has(body.priority as TaskPriority)) {
      throw createProblemError({ status: 400, title: 'invalid priority' })
    }
    priority = body.priority as TaskPriority
  }

  const dueAt = typeof body?.due_at === 'number' ? body.due_at : null
  const assigneeEmail = body?.assignee_email?.trim() || null

  const now0 = Math.floor(Date.now() / 1000)
  const remindAt = typeof body?.remind_at === 'number' ? body.remind_at : null
  if (remindAt !== null && remindAt < now0 - 60) {
    // Allow up to a minute of clock skew; reject anything substantially in the past.
    throw createProblemError({ status: 400, title: 'remind_at must be in the future' })
  }
  const reminderMax = (typeof body?.reminder_max === 'number' && body.reminder_max >= 0 && body.reminder_max <= 50)
    ? Math.floor(body.reminder_max)
    : 5
  const contextUrl = body?.context_url?.trim() || null
  if (contextUrl && contextUrl.length > 2048) {
    throw createProblemError({ status: 400, title: 'context_url must be ≤ 2048 chars' })
  }
  const contextSummary = body?.context_summary?.trim() || null
  if (contextSummary && contextSummary.length > 1000) {
    throw createProblemError({ status: 400, title: 'context_summary must be ≤ 1000 chars' })
  }
  const dedupKey = body?.dedup_key?.trim() || null
  if (dedupKey && dedupKey.length > 255) {
    throw createProblemError({ status: 400, title: 'dedup_key must be ≤ 255 chars' })
  }

  const db = useDb()
  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userEmail, caller.email)))
    .get()
  if (!membership) throw createProblemError({ status: 403, title: 'Not a team member' })
  if (membership.role === 'viewer') {
    throw createProblemError({ status: 403, title: 'Viewers cannot create tasks' })
  }

  // Optional lane placement. A lane sets the task's status to its bucket;
  // without one, lane_id stays NULL and the task falls into the first lane of
  // its status bucket when rendered.
  let laneId: string | null = body?.lane_id?.trim() || null
  let finalStatus: TaskStatus = status
  if (laneId) {
    const team = await db.select({ lanes: teams.lanes }).from(teams).where(eq(teams.id, teamId)).get()
    const lane = laneById(resolveLanes(team?.lanes), laneId)
    if (!lane) throw createProblemError({ status: 400, title: 'lane not found in this team' })
    laneId = lane.id
    finalStatus = lane.status
  }

  // Idempotency: if a dedup_key is given and an open/doing task already carries
  // it in this team, return that one instead of creating a duplicate. A
  // done/archived task for the same key does not block a legitimately new task.
  if (dedupKey) {
    const dup = await db
      .select()
      .from(tasks)
      .where(and(
        eq(tasks.teamId, teamId),
        eq(tasks.dedupKey, dedupKey),
        isNull(tasks.deletedAt),
        inArray(tasks.status, ['open', 'doing']),
      ))
      .get()
    if (dup) {
      setResponseStatus(event, 200)
      return { ...serializeTask(dup), deduped: true }
    }
  }

  // Append to end: sort_order = max(sort_order) + 1 for non-done tasks in this team.
  const existing = await db
    .select({ sortOrder: tasks.sortOrder })
    .from(tasks)
    .where(and(eq(tasks.teamId, teamId), isNull(tasks.deletedAt)))
    .all()
  const maxOrder = existing.reduce((m, t) => (t.sortOrder > m ? t.sortOrder : m), 0)
  const sortOrder = maxOrder + 1

  const now = Math.floor(Date.now() / 1000)
  const id = ulid()
  await db.insert(tasks).values({
    id,
    teamId,
    title,
    notes: body?.notes ?? '',
    status: finalStatus,
    priority,
    dueAt,
    assigneeEmail,
    laneId,
    sortOrder,
    remindAt,
    reminderMax,
    contextUrl,
    contextSummary,
    dedupKey,
    ownerEmail: caller.email,
    createdAt: now,
    updatedAt: now,
    updatedBy: caller.email,
    completedAt: finalStatus === 'done' ? now : null,
  })

  const row = await db.select().from(tasks).where(eq(tasks.id, id)).get()
  if (!row) throw createProblemError({ status: 500, title: 'Task disappeared after insert' })

  setResponseStatus(event, 201)
  return serializeTask(row)
})
