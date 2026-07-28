import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Hierarchie: Company → Project → TimeEntry. Zweistufiges RBAC über
// company_members (owner|manager|member) und project_members (manager|member).
// Siehe docs/superpowers/specs/2026-05-15-timetrack-design.md §3/§4.

export const companies = sqliteTable('companies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  archivedAt: integer('archived_at'),
})

export const companyMembers = sqliteTable('company_members', {
  companyId: text('company_id').notNull(),
  userEmail: text('user_email').notNull(),
  role: text('role', { enum: ['owner', 'manager', 'member'] }).notNull(),
  joinedAt: integer('joined_at').notNull(),
}, t => [
  primaryKey({ columns: [t.companyId, t.userEmail] }),
  index('idx_cm_email').on(t.userEmail),
])

export const companyInvites = sqliteTable('company_invites', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  createdBy: text('created_by').notNull(),
  note: text('note'),
  grantRole: text('grant_role', { enum: ['owner', 'manager', 'member'] }).notNull(),
  maxUses: integer('max_uses').notNull().default(5),
  usedCount: integer('used_count').notNull().default(0),
  expiresAt: integer('expires_at').notNull(),
  revokedAt: integer('revoked_at'),
  createdAt: integer('created_at').notNull(),
}, t => [
  index('idx_ci_company').on(t.companyId),
  index('idx_ci_active').on(t.revokedAt, t.expiresAt),
])

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  archivedAt: integer('archived_at'),
}, t => [
  index('idx_proj_company').on(t.companyId),
])

export const projectMembers = sqliteTable('project_members', {
  projectId: text('project_id').notNull(),
  userEmail: text('user_email').notNull(),
  role: text('role', { enum: ['manager', 'member'] }).notNull(),
  joinedAt: integer('joined_at').notNull(),
}, t => [
  primaryKey({ columns: [t.projectId, t.userEmail] }),
  index('idx_pm_email').on(t.userEmail),
])

export const projectInvites = sqliteTable('project_invites', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  createdBy: text('created_by').notNull(),
  note: text('note'),
  grantRole: text('grant_role', { enum: ['manager', 'member'] }).notNull(),
  maxUses: integer('max_uses').notNull().default(5),
  usedCount: integer('used_count').notNull().default(0),
  expiresAt: integer('expires_at').notNull(),
  revokedAt: integer('revoked_at'),
  createdAt: integer('created_at').notNull(),
}, t => [
  index('idx_pi_project').on(t.projectId),
  index('idx_pi_active').on(t.revokedAt, t.expiresAt),
])

export const timeEntries = sqliteTable('time_entries', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  projectId: text('project_id').notNull(),
  userEmail: text('user_email').notNull(),
  // Provenienz: ob der Eintrag von einem Agenten on-behalf-of erfasst wurde.
  act: text('act', { enum: ['human', 'agent'] }).notNull().default('human'),
  // Tagesbucket (YYYY-MM-DD) für Reports — entkoppelt von started/ended.
  entryDate: text('entry_date').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  // Optional: konkreter Zeitblock wenn bekannt (Agent loggt z.B. 14:00–14:45).
  startedAt: integer('started_at'),
  endedAt: integer('ended_at'),
  description: text('description').notNull().default(''),
  type: text('type', {
    enum: ['code', 'research', 'planning', 'review', 'admin', 'meeting'],
  }).notNull().default('code'),
  billable: integer('billable', { mode: 'boolean' }).notNull().default(true),
  // Pause/Break entry. A break is never billable; reports tally break
  // minutes separately from work minutes.
  isBreak: integer('is_break', { mode: 'boolean' }).notNull().default(false),
  createdVia: text('created_via', { enum: ['cli', 'web'] }).notNull().default('web'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  updatedBy: text('updated_by').notNull(),
  deletedAt: integer('deleted_at'),
}, t => [
  index('idx_te_company_date').on(t.companyId, t.entryDate),
  index('idx_te_project_date').on(t.projectId, t.entryDate),
  index('idx_te_user_date').on(t.userEmail, t.entryDate),
])
