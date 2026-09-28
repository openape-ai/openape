import { blob, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  /** Unguessable share token — the public report URL is /r/<slug>. */
  slug: text('slug').notNull().unique(),
  reportType: text('report_type', { enum: ['test', 'briefing', 'document'] }).notNull().default('test'),
  visibility: text('visibility', { enum: ['shared', 'private'] }).notNull().default('shared'),
  title: text('title').notNull(),
  project: text('project'),
  /** Markdown summary shown at the top of the report. */
  summary: text('summary'),
  /** Aggregated over tests: failed > passed > skipped. */
  status: text('status', { enum: ['passed', 'failed', 'skipped'] }),
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
  reportType: text('report_type', { enum: ['test', 'briefing'] }).notNull().default('test'),
  version: integer('version').notNull(),
  title: text('title').notNull(),
  project: text('project'),
  summary: text('summary'),
  status: text('status', { enum: ['passed', 'failed', 'skipped'] }),
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

export const reportSeries = sqliteTable('report_series', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  publisher: text('publisher'),
  revision: integer('revision').notNull().default(1),
  createdAt: integer('created_at').notNull(),
})

export const reportPublications = sqliteTable('report_publications', {
  id: text('id').primaryKey(),
  seriesId: text('series_id').notNull(),
  editionDate: text('edition_date').notNull(),
  version: integer('version').notNull(),
  digest: text('digest').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  publisher: text('publisher').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const documentPublications = sqliteTable('document_publications', {
  id: text('id').primaryKey(),
  seriesId: text('series_id'),
  version: integer('version').notNull(),
  owner: text('owner').notNull(),
  publisher: text('publisher').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  digest: text('digest').notNull(),
  artifactDigest: text('artifact_digest').notNull(),
  policyVersion: text('policy_version').notNull(),
  category: text('category'),
  categoryKey: text('category_key'),
  language: text('language'),
  artifact: text('artifact').notNull(),
  createdAt: integer('created_at').notNull(),
})
