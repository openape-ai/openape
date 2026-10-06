import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// A workspace is the container: deals, contacts, companies and notes all hang
// daran, Zugriff regelt workspace_members (owner|manager|member).

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  archivedAt: integer('archived_at'),
})

export const workspaceMembers = sqliteTable('workspace_members', {
  workspaceId: text('workspace_id').notNull(),
  userEmail: text('user_email').notNull(),
  role: text('role', { enum: ['owner', 'manager', 'member'] }).notNull(),
  joinedAt: integer('joined_at').notNull(),
}, t => [
  primaryKey({ columns: [t.workspaceId, t.userEmail] }),
  index('idx_wm_email').on(t.userEmail),
])

export const workspaceInvites = sqliteTable('workspace_invites', {
  id: text('id').primaryKey(),
  /** Random secret from the invitation link — no JWT, no secret needed. */
  token: text('token').notNull().unique(),
  workspaceId: text('workspace_id').notNull(),
  createdBy: text('created_by').notNull(),
  note: text('note'),
  grantRole: text('grant_role', { enum: ['owner', 'manager', 'member'] }).notNull(),
  maxUses: integer('max_uses').notNull().default(5),
  usedCount: integer('used_count').notNull().default(0),
  expiresAt: integer('expires_at').notNull(),
  revokedAt: integer('revoked_at'),
  createdAt: integer('created_at').notNull(),
}, t => [
  index('idx_wi_workspace').on(t.workspaceId),
])

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  domain: text('domain'),
  createdAt: integer('created_at').notNull(),
}, t => [
  index('idx_org_workspace').on(t.workspaceId),
])

export const contacts = sqliteTable('contacts', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  orgId: text('org_id'),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  createdAt: integer('created_at').notNull(),
}, t => [
  index('idx_contact_workspace').on(t.workspaceId),
])

export const pipelineStages = sqliteTable('pipeline_stages', {
  workspaceId: text('workspace_id').notNull(),
  /** Stable key that `deals.stage` points at — renaming only touches `name`. */
  key: text('key').notNull(),
  name: text('name').notNull(),
  /** Only `outcome` decides whether it closes, never the stage name. */
  outcome: text('outcome', { enum: ['open', 'won', 'lost'] }).notNull().default('open'),
  position: integer('position').notNull(),
}, t => [
  primaryKey({ columns: [t.workspaceId, t.key] }),
])

export const deals = sqliteTable('deals', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  title: text('title').notNull(),
  /** Amount in cents, EUR. No float, no second currency. */
  valueCents: integer('value_cents').notNull().default(0),
  stage: text('stage').notNull(),
  contactId: text('contact_id'),
  orgId: text('org_id'),
  /** Reihenfolge innerhalb der Stage-Spalte, aufsteigend. */
  position: integer('position').notNull().default(0),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  closedAt: integer('closed_at'),
}, t => [
  index('idx_deal_workspace').on(t.workspaceId),
  index('idx_deal_stage').on(t.workspaceId, t.stage, t.position),
])

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  dealId: text('deal_id').notNull(),
  authorEmail: text('author_email').notNull(),
  body: text('body').notNull(),
  createdAt: integer('created_at').notNull(),
}, t => [
  index('idx_note_deal').on(t.dealId, t.createdAt),
])
