import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Repo registry. `owner` is a URL namespace slug (like a GitHub org), while
// `ownerEmail` is the DDISA identity that controls the repo. Transport and API
// resolve owner/name against this table — never against the filesystem.
export const repos = sqliteTable('repos', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  name: text('name').notNull(),
  ownerEmail: text('owner_email').notNull(),
  defaultBranch: text('default_branch').notNull().default('main'),
  createdAt: integer('created_at').notNull(),
}, t => [
  uniqueIndex('idx_repos_owner_name').on(t.owner, t.name),
  index('idx_repos_owner_email').on(t.ownerEmail),
])

// Grant storage for @openape/grants — same column layout as the IdP's store
// (apps/openape-free-idp) so the library semantics carry over unchanged.
export const grants = sqliteTable('grants', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  type: text('type'),
  requester: text('requester').notNull(),
  targetHost: text('target_host').notNull(),
  audience: text('audience').notNull(),
  grantType: text('grant_type').notNull(),
  request: text('request', { mode: 'json' }).notNull(),
  createdAt: integer('created_at').notNull(),
  decidedAt: integer('decided_at'),
  decidedBy: text('decided_by'),
  expiresAt: integer('expires_at'),
  usedAt: integer('used_at'),
}, t => [
  index('idx_grants_status').on(t.status),
  index('idx_grants_requester').on(t.requester),
])
