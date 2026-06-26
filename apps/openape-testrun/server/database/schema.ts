import { blob, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  /** Unguessable share token — the public report URL is /r/<slug>. */
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  project: text('project'),
  /** Markdown summary shown at the top of the report. */
  summary: text('summary'),
  /** Aggregated over tests: failed > passed > skipped. */
  status: text('status', { enum: ['passed', 'failed', 'skipped'] }).notNull(),
  passedCount: integer('passed_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  /** Full validated manifest (tests + steps) as JSON. */
  manifest: text('manifest').notNull(),
  startedAt: integer('started_at'),
  finishedAt: integer('finished_at'),
  createdBy: text('created_by').notNull(),
  createdByAct: text('created_by_act', { enum: ['human', 'agent'] }).notNull().default('human'),
  createdAt: integer('created_at').notNull(),
  deletedAt: integer('deleted_at'),
}, t => [
  index('idx_runs_creator').on(t.createdBy),
  index('idx_runs_created').on(t.createdAt),
])

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  /** Path as referenced by the manifest's `shot` fields, e.g. "login/01-landing.png". */
  path: text('path').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  bytes: blob('bytes', { mode: 'buffer' }).notNull(),
  createdAt: integer('created_at').notNull(),
}, t => [
  index('idx_assets_run').on(t.runId),
  index('idx_assets_run_path').on(t.runId, t.path),
])
