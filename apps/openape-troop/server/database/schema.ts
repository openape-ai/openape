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
  // Agent X25519 encryption public key (base64url DER), reported on
  // sync (M2b writes it on the host). troop seals capability secrets
  // to this key; only the agent's private key can open them. Null
  // until the agent has synced at least once post-spawn.
  pubkeyX25519: text('pubkey_x25519'),
  // Persona / behaviour rules that apply to every interaction with this
  // agent — both cron-driven task runs and live chat-bridge messages
  // inherit it as the LLM `system` message. Per-task `userPrompt` is
  // the imperative job description; per-chat user-input is the human's
  // current message.
  systemPrompt: text('system_prompt').notNull().default(''),
  // Tool whitelist — JSON string array of tool names from
  // `tool-catalog.json`. New agents start with all-tools-enabled
  // on first sync; owners narrow via the troop UI (or PATCH
  // `/api/agents/:email/tools`). The chat-bridge reads this list
  // from `~/.openape/agent/agent.json` after each sync.
  tools: text('tools', { mode: 'json' }).notNull().$type<string[]>().default([]),
  // Free-text behaviour layer the owner can edit any time without a
  // re-deploy; appended to systemPrompt at sync (see system-prompt.ts).
  // For recipe agents systemPrompt is the (immutable) intent and this
  // is the mutable augmentation. (Agent Recipe M5.)
  userAddendum: text('user_addendum').notNull().default(''),
  // (legacy) `soul` text column still exists in the DB for back-compat
  // with rows written before the SOUL.md + system_prompt merge. New code
  // doesn't read or write it — the system_prompt above absorbed its role.
  // Future migration can DROP COLUMN once we're confident no read path
  // is left. Drizzle doesn't reference it, so it's a benign tombstone.
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
//
// `userPrompt` is the imperative job description ("read my mail and
// summarise"). It's combined with the agent-level `systemPrompt` at run
// time: system = agent.systemPrompt, user = task.userPrompt. Pre-refactor
// schema had a per-task `system_prompt` instead; the migration in
// `02.database.ts` renames it to keep existing data.
export const tasks = sqliteTable('tasks', {
  agentEmail: text('agent_email').notNull(),
  taskId: text('task_id').notNull(),
  name: text('name').notNull(),
  cron: text('cron').notNull(),
  userPrompt: text('user_prompt').notNull(),
  tools: text('tools', { mode: 'json' }).notNull().$type<string[]>(),
  maxSteps: integer('max_steps').notNull().default(10),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  primaryKey({ columns: [table.agentEmail, table.taskId] }),
])

// agent_skills — per-agent skill catalog (OpenClaw-style SKILL.md
// metadata). Each row turns into a `<name>/SKILL.md` file on the
// agent host after sync. The agent runtime injects a short
// `<available_skills>` block listing `name` + `description` into
// every system prompt; the body itself is loaded lazily by the LLM
// via the file.read tool when the task matches the description.
// Empty/missing rows = the agent runs with only its built-in default
// skills (shipped in the ape-agent npm package).
export const agentSkills = sqliteTable('agent_skills', {
  agentEmail: text('agent_email').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  body: text('body').notNull(),
  // Soft-disable a skill without deleting it. Owner-controlled toggle
  // in the troop UI; disabled skills are excluded from the agent's
  // sync payload so the LLM never sees them.
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  primaryKey({ columns: [table.agentEmail, table.name] }),
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

// agent_secrets — capability secrets bound to an agent, sealed at rest.
// `sealed` is the JSON of an @openape/core SealedBox encrypted to the
// agent's X25519 public key the moment the owner submitted the value;
// troop never stores or logs the plaintext. Revoke is a soft tombstone
// (`revoked_at` set, `sealed` cleared) so the next push clears the
// agent's copy and the binding history stays auditable. Composite PK
// (agent_email, env) — one binding per env var per agent.
export const agentSecrets = sqliteTable('agent_secrets', {
  agentEmail: text('agent_email').notNull(),
  env: text('env').notNull(),
  sealed: text('sealed'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  revokedAt: integer('revoked_at'),
}, table => [
  primaryKey({ columns: [table.agentEmail, table.env] }),
])
