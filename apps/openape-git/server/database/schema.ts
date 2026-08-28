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

// Webhook subscriptions per repo (plan M5). `secret` is the shared HMAC key:
// the forge signs outgoing deliveries with it, and the consumer signs its
// commit-status and archive requests back with the same key.
export const webhooks = sqliteTable('webhooks', {
  id: text('id').primaryKey(),
  repoId: text('repo_id').notNull(),
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  createdAt: integer('created_at').notNull(),
}, t => [index('idx_webhooks_repo').on(t.repoId)])

// One row per delivery attempt — the visible proof that an event went out.
export const webhookDeliveries = sqliteTable('webhook_deliveries', {
  id: text('id').primaryKey(),
  webhookId: text('webhook_id').notNull(),
  repoId: text('repo_id').notNull(),
  event: text('event').notNull(),
  ref: text('ref').notNull(),
  statusCode: integer('status_code'),
  error: text('error'),
  durationMs: integer('duration_ms').notNull(),
  createdAt: integer('created_at').notNull(),
}, t => [index('idx_deliveries_repo').on(t.repoId, t.createdAt)])

// CI results reported back by a webhook consumer, one row per (sha, context).
export const commitStatuses = sqliteTable('commit_statuses', {
  id: text('id').primaryKey(),
  repoId: text('repo_id').notNull(),
  sha: text('sha').notNull(),
  context: text('context').notNull(),
  state: text('state').notNull(),
  description: text('description'),
  targetUrl: text('target_url'),
  log: text('log'),
  createdAt: integer('created_at').notNull(),
}, t => [uniqueIndex('idx_status_repo_sha_context').on(t.repoId, t.sha, t.context)])

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

// Pull requests (plan M6). A PR is a ref pair plus review metadata — the diff,
// the mergeability and the merge commit all come from git itself, so nothing
// derived is stored here. `number` is per repo, like every forge.
export const pulls = sqliteTable('pulls', {
  id: text('id').primaryKey(),
  repoId: text('repo_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  sourceRef: text('source_ref').notNull(),
  targetRef: text('target_ref').notNull(),
  state: text('state').notNull().default('open'),
  authorEmail: text('author_email').notNull(),
  mergeSha: text('merge_sha'),
  createdAt: integer('created_at').notNull(),
  mergedAt: integer('merged_at'),
}, t => [
  uniqueIndex('idx_pulls_repo_number').on(t.repoId, t.number),
  index('idx_pulls_repo_state').on(t.repoId, t.state),
])

// Review comments. `path`+`line` anchor a comment to a diff line; both null
// means a comment on the PR as a whole.
export const pullComments = sqliteTable('pull_comments', {
  id: text('id').primaryKey(),
  pullId: text('pull_id').notNull(),
  authorEmail: text('author_email').notNull(),
  body: text('body').notNull(),
  path: text('path'),
  line: integer('line'),
  createdAt: integer('created_at').notNull(),
}, t => [index('idx_pull_comments_pull').on(t.pullId, t.createdAt)])
