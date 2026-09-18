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
  reportingEnabled: integer('reporting_enabled').notNull().default(0),
  issueHomeOnly: integer('issue_home_only').notNull().default(0),
  codeSourceUrl: text('code_source_url'),
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

// One target this repo replicates its refs to after every push.
export const mirrors = sqliteTable('mirrors', {
  id: text('id').primaryKey(),
  repoId: text('repo_id').notNull(),
  url: text('url').notNull(),
  username: text('username').notNull(),
  // Write credential for the target forge; scope it to the one repo there.
  token: text('token').notNull(),
  enabled: integer('enabled').notNull().default(1),
  createdAt: integer('created_at').notNull(),
}, t => [index('idx_mirrors_repo').on(t.repoId)])

// One row per push attempt per ref. `error` is redacted before it is stored.
export const mirrorPushes = sqliteTable('mirror_pushes', {
  id: text('id').primaryKey(),
  mirrorId: text('mirror_id').notNull(),
  repoId: text('repo_id').notNull(),
  ref: text('ref').notNull(),
  sha: text('sha').notNull(),
  ok: integer('ok').notNull(),
  error: text('error'),
  durationMs: integer('duration_ms').notNull(),
  createdAt: integer('created_at').notNull(),
}, t => [index('idx_mirror_pushes_repo').on(t.repoId, t.createdAt)])

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

// Durable per-ref observations survive restarts and identify owned deletions.
export const mirrorRefStates = sqliteTable('mirror_ref_states', {
  mirrorId: text('mirror_id').notNull(),
  ref: text('ref').notNull(),
  sourceSha: text('source_sha'),
  targetSha: text('target_sha'),
  lastSuccessfulSha: text('last_successful_sha'),
  checkedAt: integer('checked_at').notNull(),
  syncedAt: integer('synced_at'),
  error: text('error'),
}, t => [uniqueIndex('idx_mirror_state_ref').on(t.mirrorId, t.ref)])

// Protected branches and their trusted external status source. Native HMAC
// statuses cannot impersonate these required Forgejo contexts.
export const branchProtections = sqliteTable('branch_protections', {
  repoId: text('repo_id').notNull(),
  branch: text('branch').notNull(),
  mirrorId: text('mirror_id').notNull(),
  contexts: text('contexts', { mode: 'json' }).$type<string[]>().notNull(),
  enabled: integer('enabled').notNull().default(1),
  updatedAt: integer('updated_at').notNull(),
  updatedBy: text('updated_by').notNull(),
}, t => [uniqueIndex('idx_protection_branch').on(t.repoId, t.branch)])

export const protectionEvents = sqliteTable('protection_events', {
  id: text('id').primaryKey(), repoId: text('repo_id').notNull(), branch: text('branch').notNull(),
  actor: text('actor').notNull(), reason: text('reason').notNull(),
  configuration: text('configuration').notNull(), createdAt: integer('created_at').notNull(),
})

export const issueCounters = sqliteTable('issue_counters', {
  repoId: text('repo_id').notNull(),
  nextNumber: integer('next_number').notNull(),
})

export const issues = sqliteTable('issues', {
  id: text('id').notNull(),
  repoId: text('repo_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  state: text('state').notNull(),
  productKey: text('product_key'),
  assignee: text('assignee'),
  authorSubject: text('author_subject'),
  authorActor: text('author_actor'),
  version: integer('version').notNull(),
  hidden: integer('hidden').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  closedAt: integer('closed_at'),
})

export const issueComments = sqliteTable('issue_comments', {
  id: text('id').notNull(),
  issueId: text('issue_id').notNull(),
  body: text('body').notNull(),
  authorSubject: text('author_subject'),
  authorActor: text('author_actor'),
  version: integer('version').notNull(),
  hidden: integer('hidden').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at'),
})

export const issueLabels = sqliteTable('issue_labels', {
  id: text('id').notNull(),
  repoId: text('repo_id').notNull(),
  name: text('name').notNull(),
  color: text('color').notNull(),
  description: text('description').notNull(),
  archived: integer('archived').notNull(),
  version: integer('version').notNull(),
})

export const issueLabelLinks = sqliteTable('issue_label_links', {
  issueId: text('issue_id').notNull(),
  labelId: text('label_id').notNull(),
})

export const issueParticipants = sqliteTable('issue_participants', {
  issueId: text('issue_id').notNull(),
  subject: text('subject').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const products = sqliteTable('issue_products', {
  key: text('key').notNull(),
  name: text('name').notNull(),
  repoId: text('repo_id').notNull(),
  routingAdmin: text('routing_admin').notNull(),
  approvedBy: text('approved_by').notNull(),
  enabled: integer('enabled').notNull(),
  version: integer('version').notNull(),
})

export const issuePullLinks = sqliteTable('issue_pull_links', {
  issueId: text('issue_id').notNull(),
  pullId: text('pull_id').notNull(),
  subject: text('subject').notNull(),
  actor: text('actor').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const issueEvents = sqliteTable('issue_events', {
  id: text('id').notNull(),
  issueId: text('issue_id').notNull(),
  action: text('action').notNull(),
  subject: text('subject').notNull(),
  actor: text('actor').notNull(),
  details: text('details').notNull(),
  createdAt: integer('created_at').notNull(),
  importBatchId: text('import_batch_id'),
})

export const issueAliases = sqliteTable('issue_aliases', {
  repoId: text('repo_id').notNull(),
  number: integer('number').notNull(),
  issueId: text('issue_id').notNull(),
})

export const legacyReferences = sqliteTable('issue_legacy_references', {
  sourceKey: text('source_key').notNull(),
  kind: text('kind').notNull(),
  issueId: text('issue_id').notNull(),
  commentId: text('comment_id'),
})

export const importBatches = sqliteTable('issue_import_batches', {
  id: text('id').notNull(),
  source: text('source').notNull(),
  manifestHash: text('manifest_hash').notNull(),
  importedBy: text('imported_by').notNull(),
  createdAt: integer('created_at').notNull(),
  status: text('status').notNull(),
})

export const importOrigins = sqliteTable('issue_import_origins', {
  sourceKey: text('source_key').notNull(),
  batchId: text('batch_id').notNull(),
  entityId: text('entity_id').notNull(),
  kind: text('kind').notNull(),
  contentHash: text('content_hash').notNull(),
  provenance: text('provenance').notNull(),
})

export const issueAttachments = sqliteTable('issue_attachments', {
  id: text('id').notNull(),
  issueId: text('issue_id').notNull(),
  commentId: text('comment_id'),
  sourceId: text('source_id').notNull(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  sha256: text('sha256').notNull(),
  storageKey: text('storage_key').notNull(),
  provenance: text('provenance').notNull(),
})

export const issueWriteRequests = sqliteTable('issue_write_requests', {
  subject: text('subject').notNull(),
  actor: text('actor').notNull(),
  operation: text('operation').notNull(),
  requestKey: text('request_key').notNull(),
  payloadHash: text('payload_hash').notNull(),
  result: text('result').notNull(),
  createdAt: integer('created_at').notNull(),
})
