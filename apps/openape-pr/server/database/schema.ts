import { blob, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const prs = sqliteTable('prs', {
  id: text('id').primaryKey(),
  /** Unguessable token — the agent polls the verdict at /api/prs/<slug>/review. */
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  /** Markdown description shown above the diff (may embed links/images). */
  description: text('description'),
  /** Who authored the PR (free text, e.g. "scribe" or an email). */
  author: text('author'),
  authorAct: text('author_act', { enum: ['human', 'agent'] }).notNull().default('agent'),
  branch: text('branch'),
  baseSha: text('base_sha'),
  headSha: text('head_sha'),
  /** Raw unified diff (git diff output). Rendered client-side by diff2html. */
  diff: text('diff').notNull(),
  status: text('status', { enum: ['pending', 'reviewed'] }).notNull().default('pending'),
  filesCount: integer('files_count').notNull().default(0),
  additions: integer('additions').notNull().default(0),
  deletions: integer('deletions').notNull().default(0),
  createdBy: text('created_by').notNull(),
  createdByAct: text('created_by_act', { enum: ['human', 'agent'] }).notNull().default('agent'),
  createdAt: integer('created_at').notNull(),
  deletedAt: integer('deleted_at'),
}, t => [
  index('idx_prs_creator').on(t.createdBy),
  index('idx_prs_created').on(t.createdAt),
])

export const reviews = sqliteTable('reviews', {
  id: text('id').primaryKey(),
  prId: text('pr_id').notNull(),
  verdict: text('verdict', { enum: ['approve', 'request-changes', 'comment'] }).notNull(),
  /** Markdown overall review comment. */
  body: text('body'),
  reviewedBy: text('reviewed_by').notNull(),
  reviewedAt: integer('reviewed_at').notNull(),
}, t => [
  index('idx_reviews_pr').on(t.prId),
])

export const comments = sqliteTable('comments', {
  id: text('id').primaryKey(),
  prId: text('pr_id').notNull(),
  reviewId: text('review_id').notNull(),
  /** File path the comment is anchored to. */
  path: text('path').notNull(),
  /** 1-based line number within the diff for `side`. */
  line: integer('line').notNull(),
  side: text('side', { enum: ['old', 'new'] }).notNull().default('new'),
  /** Markdown comment body. */
  body: text('body').notNull(),
  /** Optional attached image asset path (→ assets.path). */
  imagePath: text('image_path'),
  createdAt: integer('created_at').notNull(),
}, t => [
  index('idx_comments_pr').on(t.prId),
  index('idx_comments_review').on(t.reviewId),
])

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  prId: text('pr_id').notNull(),
  /** Relative path, e.g. "desc/before.png" or "comments/<uuid>.png". */
  path: text('path').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  bytes: blob('bytes', { mode: 'buffer' }).notNull(),
  createdAt: integer('created_at').notNull(),
}, t => [
  index('idx_assets_pr').on(t.prId),
  index('idx_assets_pr_path').on(t.prId, t.path),
])
