import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  archivedAt: integer('archived_at'),
})

export const teamMembers = sqliteTable('team_members', {
  teamId: text('team_id').notNull(),
  userEmail: text('user_email').notNull(),
  role: text('role', { enum: ['owner', 'editor', 'viewer'] }).notNull(),
  joinedAt: integer('joined_at').notNull(),
}, t => [
  primaryKey({ columns: [t.teamId, t.userEmail] }),
  index('idx_tm_email').on(t.userEmail),
])

export const plans = sqliteTable('plans', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull(),
  title: text('title').notNull(),
  bodyMd: text('body_md').notNull().default(''),
  status: text('status', { enum: ['draft', 'active', 'done', 'archived'] }).notNull().default('draft'),
  ownerEmail: text('owner_email').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  updatedBy: text('updated_by').notNull(),
  deletedAt: integer('deleted_at'),
}, t => [
  index('idx_plans_team').on(t.teamId),
  index('idx_plans_owner').on(t.ownerEmail),
  index('idx_plans_updated').on(t.updatedAt),
])

export const teamInvites = sqliteTable('team_invites', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull(),
  createdBy: text('created_by').notNull(),
  note: text('note'),
  maxUses: integer('max_uses').notNull().default(5),
  usedCount: integer('used_count').notNull().default(0),
  expiresAt: integer('expires_at').notNull(),
  revokedAt: integer('revoked_at'),
  createdAt: integer('created_at').notNull(),
}, t => [
  index('idx_ti_team').on(t.teamId),
  index('idx_ti_active').on(t.revokedAt, t.expiresAt),
])
