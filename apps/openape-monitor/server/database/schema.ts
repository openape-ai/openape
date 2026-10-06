import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** Minimum seconds between checks a user may configure. */
export const MIN_INTERVAL_SEC = 60
export const DEFAULT_INTERVAL_SEC = 300

/**
 * How a monitor learns whether its subject is alive.
 * `http` polls a URL. `heartbeat` waits to be pinged and treats silence as
 * down — the only shape that works for something without a public URL, and
 * the only one that also catches "the whole machine is gone".
 */
export type MonitorKind = 'http' | 'heartbeat'

export const monitors = sqliteTable('monitors', {
  id: text('id').primaryKey(),
  ownerEmail: text('owner_email').notNull(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['http', 'heartbeat'] }).notNull().default('http'),
  /** The polled URL for `http` monitors; empty for `heartbeat` ones. */
  url: text('url').notNull(),
  /** Secret in the ping URL. Heartbeat monitors only. */
  pingToken: text('ping_token'),
  lastPingAt: integer('last_ping_at'),
  intervalSec: integer('interval_sec').notNull().default(DEFAULT_INTERVAL_SEC),
  /** Last check outcome, denormalised onto the monitor for cheap listing. */
  lastStatus: text('last_status', { enum: ['up', 'down'] }),
  lastCode: integer('last_code'),
  lastLatencyMs: integer('last_latency_ms'),
  lastError: text('last_error'),
  lastCheckedAt: integer('last_checked_at'),
  createdAt: integer('created_at').notNull(),
}, t => [
  index('idx_monitors_owner').on(t.ownerEmail),
  index('idx_monitors_ping_token').on(t.pingToken),
  index('idx_monitors_due').on(t.lastCheckedAt),
])

export const checks = sqliteTable('checks', {
  id: text('id').primaryKey(),
  monitorId: text('monitor_id').notNull(),
  ts: integer('ts').notNull(),
  up: integer('up', { mode: 'boolean' }).notNull(),
  statusCode: integer('status_code'),
  latencyMs: integer('latency_ms'),
  error: text('error'),
}, t => [
  index('idx_checks_monitor_ts').on(t.monitorId, t.ts),
])
