import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * The one table of this app: an append-only KPI time series. Agents push rows
 * via `ape-kpi push`; the UI and the morning mail are pure consumers.
 *
 * `owner` and `source` come from the caller's token, never from the body —
 * a delegated agent pushes for its user (owner = the delegating user).
 * `scope` is a free hierarchical slash path the app does NOT interpret;
 * it only groups (top-level segment = section).
 */
export const kpis = sqliteTable('kpis', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  scope: text('scope').notNull(),
  key: text('key').notNull(),
  value: real('value').notNull(),
  unit: text('unit'),
  detail: text('detail'),
  link: text('link'),
  source: text('source').notNull(),
  createdAt: integer('created_at').notNull(),
})

export type KpiRow = typeof kpis.$inferSelect
