import { and, eq, isNull } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { useDb } from '../../database/drizzle'
import { tasks, teamMembers, teams } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { createProblemError } from '../../utils/problem'
import { laneById, laneForStatus, resolveLanes } from '../../utils/lanes'
import {
  serializeTask,
  VALID_PRIORITY,
  VALID_STATUS,
  type TaskPriority,
  type TaskStatus,
} from '../../utils/task-shape'

interface PatchBody {
  title?: string
  notes?: string
  status?: string
  priority?: string | null
  due_at?: number | null
  assignee_email?: string | null
  /** Move to a board lane (id or name). Also sets status to the lane's bucket. */
  lane_id?: string | null
  sort_order?: number
  remind_at?: number | null
  reminder_max?: number
  context_url?: string | null
  context_summary?: string | null
  /** Reset reminder_count + last_reminder_at — useful for snooze UX. */
  reset_reminders?: boolean
}

type TaskPatch = Partial<{
  title: string
  notes: string
  status: TaskStatus
  priority: TaskPriority | null
  dueAt: number | null
  assigneeEmail: string | null
  laneId: string | null
  sortOrder: number
  completedAt: number | null
  remindAt: number | null
  reminderMax: number
  contextUrl: string | null
  contextSummary: string | null
  reminderCount: number
  lastReminderAt: number | null
}>

/**
 * PATCH /api/tasks/:id — update fields. Viewers cannot edit.
 *
 * Status change to/from 'done' also updates completed_at.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'Missing task id' })

  const body = await readBody<PatchBody>(event)
  const patch: TaskPatch = {}

  if (body.title !== undefined) {
    const t = body.title.trim()
    if (!t || t.length > 200) throw createProblemError({ status: 400, title: 'title must be 1–200 chars' })
    patch.title = t
  }
  if (body.notes !== undefined) patch.notes = body.notes
  if (body.status !== undefined) {
    if (!VALID_STATUS.has(body.status as TaskStatus)) {
      throw createProblemError({ status: 400, title: 'invalid status' })
    }
    patch.status = body.status as TaskStatus
  }
  if (body.priority !== undefined) {
    if (body.priority === null || body.priority === '') {
      patch.priority = null
    }
    else if (VALID_PRIORITY.has(body.priority as TaskPriority)) {
      patch.priority = body.priority as TaskPriority
    }
    else {
      throw createProblemError({ status: 400, title: 'invalid priority' })
    }
  }
  if (body.due_at !== undefined) patch.dueAt = body.due_at
  if (body.assignee_email !== undefined) {
    patch.assigneeEmail = body.assignee_email?.trim() || null
  }
  if (body.sort_order !== undefined && Number.isInteger(body.sort_order)) {
    patch.sortOrder = body.sort_order
  }
  if (body.remind_at !== undefined) {
    if (body.remind_at !== null && (typeof body.remind_at !== 'number' || !Number.isFinite(body.remind_at))) {
      throw createProblemError({ status: 400, title: 'remind_at must be a unix-seconds number or null' })
    }
    patch.remindAt = body.remind_at
    // Setting a new remind_at resets the escalation counter so the worker
    // sends a fresh first mail instead of treating the rescheduled time
    // as a continuation.
    if (body.remind_at !== null) {
      patch.reminderCount = 0
      patch.lastReminderAt = null
    }
  }
  if (typeof body.reminder_max === 'number' && body.reminder_max >= 0 && body.reminder_max <= 50) {
    patch.reminderMax = Math.floor(body.reminder_max)
  }
  if (body.context_url !== undefined) {
    const url = body.context_url?.trim() || null
    if (url && url.length > 2048) {
      throw createProblemError({ status: 400, title: 'context_url must be ≤ 2048 chars' })
    }
    patch.contextUrl = url
  }
  if (body.context_summary !== undefined) {
    const summary = body.context_summary?.trim() || null
    if (summary && summary.length > 1000) {
      throw createProblemError({ status: 400, title: 'context_summary must be ≤ 1000 chars' })
    }
    patch.contextSummary = summary
  }
  if (body.reset_reminders) {
    patch.reminderCount = 0
    patch.lastReminderAt = null
  }

  if (Object.keys(patch).length === 0 && body.lane_id === undefined) {
    throw createProblemError({ status: 400, title: 'No fields to update' })
  }

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
  if (membership.role === 'viewer') throw createProblemError({ status: 403, title: 'Viewers cannot edit tasks' })

  // Lane move: resolve against the team's lanes. Moving to a lane also sets
  // status to that lane's bucket (lane_id wins over a passed status). When only
  // status changed, snap lane_id to the first lane of the new bucket so the two
  // axes never drift apart.
  if (body.lane_id !== undefined || patch.status !== undefined) {
    const team = await db.select({ lanes: teams.lanes }).from(teams).where(eq(teams.id, task.teamId)).get()
    const lanes = resolveLanes(team?.lanes)
    if (typeof body.lane_id === 'string' && body.lane_id.trim()) {
      const lane = laneById(lanes, body.lane_id)
      if (!lane) throw createProblemError({ status: 400, title: 'lane not found in this team' })
      patch.laneId = lane.id
      patch.status = lane.status
    }
    else if (body.lane_id === null || body.lane_id === '') {
      patch.laneId = null
    }
    else if (patch.status !== undefined) {
      patch.laneId = laneForStatus(lanes, patch.status, task.laneId)
    }
  }

  const now = Math.floor(Date.now() / 1000)
  if (patch.status !== undefined) {
    if (patch.status === 'done' && task.status !== 'done') patch.completedAt = now
    if (patch.status !== 'done' && task.status === 'done') patch.completedAt = null
  }

  await db
    .update(tasks)
    .set({ ...patch, updatedAt: now, updatedBy: caller.email })
    .where(eq(tasks.id, id))
    .run()

  const updated = await db.select().from(tasks).where(eq(tasks.id, id)).get()
  if (!updated) throw createProblemError({ status: 500, title: 'Task disappeared after update' })

  return serializeTask(updated)
})
