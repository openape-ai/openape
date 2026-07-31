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
  /**
   * Optional stability key, scoped per uploader: re-uploading with the same
   * (createdBy, series) updates this row in place — same slug, version + 1.
   */
  series: text('series'),
  /** Version currently shown at /r/<slug>; prior versions live in runVersions. */
  version: integer('version').notNull().default(1),
}, t => [
  index('idx_runs_creator').on(t.createdBy),
  index('idx_runs_created').on(t.createdAt),
  index('idx_runs_series').on(t.createdBy, t.series),
])

/** Snapshot of a run's fields as they were before a series re-upload replaced them. */
export const runVersions = sqliteTable('run_versions', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  version: integer('version').notNull(),
  title: text('title').notNull(),
  project: text('project'),
  summary: text('summary'),
  status: text('status', { enum: ['passed', 'failed', 'skipped'] }).notNull(),
  passedCount: integer('passed_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  manifest: text('manifest').notNull(),
  startedAt: integer('started_at'),
  finishedAt: integer('finished_at'),
  createdAt: integer('created_at').notNull(),
}, t => [
  index('idx_run_versions_run').on(t.runId, t.version),
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
  /** Run version this asset belongs to — each series version keeps its own shots. */
  version: integer('version').notNull().default(1),
}, t => [
  index('idx_assets_run').on(t.runId),
  index('idx_assets_run_path').on(t.runId, t.path),
])
