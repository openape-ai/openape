import type { TaskState } from './types'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// The SP includes this table in its own Drizzle DB. A2A field names so the
// store doubles as an A2A task record; `assignee`/`lease_until`/`delivery_count`
// carry the SQS-style lease bookkeeping that the queue ops use.
export const agentTasks = sqliteTable('agent_tasks', {
  id: text('id').primaryKey(),
  contextId: text('context_id').notNull(),
  type: text('type').notNull(),
  state: text('state').notNull().$type<TaskState>().default('submitted'),
  history: text('history').notNull().default('[]'),
  artifacts: text('artifacts').notNull().default('[]'),
  assignee: text('assignee'),
  leaseUntil: integer('lease_until'),
  deliveryCount: integer('delivery_count').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, t => [
  index('idx_agent_tasks_state').on(t.state),
  index('idx_agent_tasks_lease').on(t.leaseUntil),
])

export type AgentTaskRow = typeof agentTasks.$inferSelect
