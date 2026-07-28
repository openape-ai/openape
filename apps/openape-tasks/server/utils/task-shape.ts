import type { tasks } from '../database/schema'

export type TaskStatus = 'open' | 'doing' | 'done' | 'archived'
export type TaskPriority = 'low' | 'med' | 'high'

export const VALID_STATUS = new Set<TaskStatus>(['open', 'doing', 'done', 'archived'])
export const VALID_PRIORITY = new Set<TaskPriority>(['low', 'med', 'high'])

type TaskRow = typeof tasks.$inferSelect

export function serializeTask(row: TaskRow) {
  return {
    id: row.id,
    team_id: row.teamId,
    title: row.title,
    notes: row.notes,
    status: row.status,
    priority: row.priority,
    due_at: row.dueAt,
    assignee_email: row.assigneeEmail,
    lane_id: row.laneId,
    sort_order: row.sortOrder,
    remind_at: row.remindAt,
    reminder_count: row.reminderCount,
    last_reminder_at: row.lastReminderAt,
    reminder_max: row.reminderMax,
    context_url: row.contextUrl,
    context_summary: row.contextSummary,
    owner_email: row.ownerEmail,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    updated_by: row.updatedBy,
    completed_at: row.completedAt,
  }
}
