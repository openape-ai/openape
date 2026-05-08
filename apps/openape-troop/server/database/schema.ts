import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// agents — one row per registered agent.
//
// PK is the agent's email (DDISA-style `agent+name+ownerdomain@id.openape.ai`).
// The IdP guarantees email uniqueness so a second `apes agents spawn alice`
// from a different host hits an IdP-side conflict before it ever reaches
// troop — the owner has to pick distinct names like `alice-laptop` /
// `alice-mini` for multi-host. `hostId` is the stable hardware-rooted
// identifier (Mac IOPlatformUUID), pinned at first sync; mismatched
// later syncs get 401 (the agent's keypair was likely copied to another
// machine). `hostname` is the human-readable name and is allowed to
// change.
export const agents = sqliteTable('agents', {
  email: text('email').primaryKey(),
  ownerEmail: text('owner_email').notNull(),
  agentName: text('agent_name').notNull(),
  hostId: text('host_id'),
  hostname: text('hostname'),
  pubkeySsh: text('pubkey_ssh'),
  firstSeenAt: integer('first_seen_at'),
  lastSeenAt: integer('last_seen_at'),
  createdAt: integer('created_at').notNull(),
}, table => [
  index('idx_agents_owner').on(table.ownerEmail),
  index('idx_agents_host').on(table.hostId),
])

// tasks — agent's cron-scheduled jobs. Composite PK (agent_email, task_id).
// `cron` accepts a small subset of standard cron syntax (see M4 docs);
// invalid lines are rejected at API-create time. `tools` is a JSON array
// of string names that must be in the catalog the apes-runtime ships.
export const tasks = sqliteTable('tasks', {
  agentEmail: text('agent_email').notNull(),
  taskId: text('task_id').notNull(),
  name: text('name').notNull(),
  cron: text('cron').notNull(),
  systemPrompt: text('system_prompt').notNull(),
  tools: text('tools', { mode: 'json' }).notNull().$type<string[]>(),
  maxSteps: integer('max_steps').notNull().default(10),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  primaryKey({ columns: [table.agentEmail, table.taskId] }),
])

// runs — execution history. Trace is JSON; capped at ~16KB by the API
// handler so the table doesn't grow unboundedly per noisy run.
export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  agentEmail: text('agent_email').notNull(),
  taskId: text('task_id').notNull(),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  status: text('status').notNull(), // 'running' | 'ok' | 'error'
  finalMessage: text('final_message'),
  stepCount: integer('step_count'),
  trace: text('trace', { mode: 'json' }),
}, table => [
  index('idx_runs_agent_task').on(table.agentEmail, table.taskId),
  index('idx_runs_started').on(table.startedAt),
])
