// Drizzle schema for coder.openape.ai (#585).
//
// Behavior contracts the tables back:
//   coder-projects.md        → `projects`, `project_members`
//                              (server/utils/projects.ts)
//   coder-invite-members.md  → `invites`, member `capabilities`, `audit_log`
//                              (server/utils/members.ts, server/utils/audit.ts)
//   coder-user-stories.md    → `stories`, `story_status_changes`
//                              (server/utils/stories.ts)
//
// List-valued columns (repos, links, test references, member capabilities) are
// stored as JSON text — the stores own the (de)serialisation so callers always
// see plain arrays.

import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  visionMd: text('vision_md').notNull().default(''),
  repos: text('repos').notNull().default('[]'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

// One row per (project, member). `role` is admin or member; admins implicitly
// hold every write capability. `capabilities` is the explicit per-member grant
// set (JSON array of WriteCapability) — empty for a freshly invited member.
export const projectMembers = sqliteTable('project_members', {
  projectId: text('project_id').notNull(),
  email: text('email').notNull(),
  role: text('role', { enum: ['admin', 'member'] }).notNull(),
  capabilities: text('capabilities').notNull().default('[]'),
  joinedAt: integer('joined_at').notNull(),
}, t => ({
  pk: primaryKey({ columns: [t.projectId, t.email] }),
}))

// Pending invitations. Realised into a project_members row on first sign-in
// (acceptInvite). `accepted_at` stays null until then. After acceptance the row
// doubles as the new member's inbox notification ("you were added to project X
// by Y") until they dismiss it, which sets `seen_at`.
export const invites = sqliteTable('invites', {
  projectId: text('project_id').notNull(),
  email: text('email').notNull(),
  invitedBy: text('invited_by').notNull(),
  createdAt: integer('created_at').notNull(),
  acceptedAt: integer('accepted_at'),
  seenAt: integer('seen_at'),
}, t => ({
  pk: primaryKey({ columns: [t.projectId, t.email] }),
}))

export const stories = sqliteTable('stories', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  title: text('title').notNull(),
  storySentence: text('story_sentence').notNull(),
  acceptanceCriteria: text('acceptance_criteria').notNull().default(''),
  repos: text('repos').notNull().default('[]'),
  links: text('links').notNull().default('[]'),
  testReferences: text('test_references').notNull().default('[]'),
  status: text('status').notNull().default('draft'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

// Append-only status-change history for a story (who set it to what, when).
export const storyStatusChanges = sqliteTable('story_status_changes', {
  id: text('id').primaryKey(),
  storyId: text('story_id').notNull(),
  projectId: text('project_id').notNull(),
  status: text('status').notNull(),
  changedBy: text('changed_by').notNull(),
  changedAt: integer('changed_at').notNull(),
})

// Project-scoped audit trail for permission changes and story status changes.
export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  action: text('action').notNull(),
  actorEmail: text('actor_email').notNull(),
  subject: text('subject').notNull(),
  detail: text('detail').notNull().default(''),
  at: integer('at').notNull(),
})

export type ProjectRow = typeof projects.$inferSelect
export type ProjectMemberRow = typeof projectMembers.$inferSelect
export type InviteRow = typeof invites.$inferSelect
export type StoryRow = typeof stories.$inferSelect
export type StoryStatusChangeRow = typeof storyStatusChanges.$inferSelect
export type AuditLogRow = typeof auditLog.$inferSelect
