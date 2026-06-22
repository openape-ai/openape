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
  // The nest this agent belongs to (the bound device's host_id, recorded at
  // spawn from the spawning nest's WS identity). Authoritative for grouping
  // agents under their nest — `hostId`/`hostname` are the agent's own runtime
  // host (e.g. a container name) and are just a detail.
  nestHostId: text('nest_host_id'),
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
  // The `<repo>@<ref>` this agent was deployed from; the agent checks
  // out its tools/ from it. Null for manually-spawned agents.
  recipeRef: text('recipe_ref'),
  // Owner-set pause: a paused agent stays enrolled but runs no LLM turns on the
  // nest (zero tokens). Authoritative state lives in the nest registry; this
  // mirror is written by the pause/resume endpoints (which originate the action)
  // so the UI can show a badge without round-tripping the nest.
  paused: integer('paused', { mode: 'boolean' }).notNull().default(false),
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
  // Optional deterministic shell command. When set, the cron-runner
  // executes it via the gated ape-shell path (no LLM round-trip, no chat
  // room needed) and `userPrompt` is only the human-readable fallback.
  // Used by the coding-agent recipe's poll schedule.
  command: text('command'),
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

// oauth_credentials — per-agent external-provider OAuth state (currently
// ChatGPT "Sign in with ChatGPT"). Holds only the transient device-flow code
// + connection status + non-secret metadata (account_id, expiry) for the UI.
// The sealed auth.json itself rides the normal agent_secrets path (env
// CHATGPT_AUTH_JSON, file-target) so it re-syncs + seeds via the M2 broker.
// Composite PK (agent_email, provider).
export const oauthCredentials = sqliteTable('oauth_credentials', {
  agentEmail: text('agent_email').notNull(),
  provider: text('provider').notNull(),
  status: text('status').notNull(), // 'pending' | 'connected' | 'denied'
  deviceCode: text('device_code'),
  userCode: text('user_code'),
  verificationUri: text('verification_uri'),
  deviceExpiresAt: integer('device_expires_at'),
  accountId: text('account_id'),
  expiresAt: integer('expires_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  primaryKey({ columns: [table.agentEmail, table.provider] }),
])

// chats — one persistent "main session" per (owner, agent) pair. Mirrors
// what chat.openape.ai modelled as a DM room + main thread, but flat and
// agent-scoped (the owner is implicit from the agent row's ownerEmail).
// Created lazily on first message either side sends.
export const chats = sqliteTable('chats', {
  // (ownerEmail, agentEmail) is the natural PK — one chat per pair —
  // but composite PKs are clunky in foreign-key joins, so use a UUID
  // and unique-index the pair below.
  id: text('id').primaryKey(),
  ownerEmail: text('owner_email').notNull(),
  agentEmail: text('agent_email').notNull(),
  createdAt: integer('created_at').notNull(),
  // Bumped on every message — drives "recent chats" ordering in any
  // future agent-list view without a per-agent message-count query.
  lastMessageAt: integer('last_message_at'),
}, table => [
  index('idx_chats_owner_agent').on(table.ownerEmail, table.agentEmail),
])

// chat_messages — the persistent log for one chat. role mirrors what
// chat.openape.ai called sender_act (`human` vs `agent`), simplified to
// just two values since troop's chat is always a 1:1.
//
// `streaming` follows the openape-chat semantics: agent posts an empty
// row, streams content via PATCH, sets streaming=false on completion.
// While streaming=true edits don't bump editedAt — so the UI can show
// a typing-indicator state without the message looking "(edited)" once
// it lands.
export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').notNull(),
  role: text('role', { enum: ['human', 'agent'] }).notNull(),
  body: text('body').notNull(),
  createdAt: integer('created_at').notNull(),
  editedAt: integer('edited_at'),
  streaming: integer('streaming', { mode: 'boolean' }).notNull().default(false),
  // Ephemeral "what is the agent doing right now" — set by the bridge
  // when a tool call starts, cleared when it completes. Cleared
  // automatically when streaming=false.
  streamingStatus: text('streaming_status'),
  // Optional reply-to-message-id; for future threading inside the chat.
  // v1 doesn't render threads but the field is here so the schema
  // doesn't have to migrate when threading lands.
  replyTo: text('reply_to'),
}, table => [
  index('idx_chat_messages_chat_created').on(table.chatId, table.createdAt),
])

// nests — one row per device (pod) bound to an Owner (M4δ).
//
// The architectural shift from agents: a nest is no longer a DDISA
// *agent* with its own keypair + IdP enrollment. It's a *device* the
// Owner authorizes via a standing delegation grant (M4γ consent). troop
// is the canonical issuer of `hostId`, and that id is only unique
// *within an owner* — the natural key is (ownerEmail, hostId), so two
// different Owners can each have a `mbp-home` without colliding.
//
// `podUuid` is the container/pod's self-reported UUID at bind time —
// purely informational (helps the Owner tell two pods apart in the UI
// and debug a recreate). `status` is 'active' until the Owner revokes
// (DELETE /api/nests/:host_id), which flips it to 'revoked' rather than
// hard-deleting so the binding history stays auditable and an in-flight
// token referencing the host_id resolves to a revoked row, not a
// missing one.
export const nests = sqliteTable('nests', {
  ownerEmail: text('owner_email').notNull(),
  hostId: text('host_id').notNull(),
  displayName: text('display_name').notNull(),
  podUuid: text('pod_uuid'),
  status: text('status', { enum: ['active', 'revoked'] }).notNull().default('active'),
  createdAt: integer('created_at').notNull(),
  lastSeenAt: integer('last_seen_at'),
  // SHA-256 (hex) of the device secret minted at bind time. The plaintext
  // is shown to the pod exactly once in the bind response; troop only ever
  // stores this hash. The pod presents the plaintext to POST /api/nests/token
  // on every reconnect to mint a short-lived nest:* troop token. Revoking the
  // nest (status='revoked') makes that exchange fail — one-click cut-off.
  deviceSecretHash: text('device_secret_hash'),
  // Client IP captured from the WS upgrade request (x-forwarded-for behind the
  // edge) on the nest's `hello` — the current address the device connects from.
  lastIp: text('last_ip'),
}, table => [
  primaryKey({ columns: [table.ownerEmail, table.hostId] }),
  index('idx_nests_owner').on(table.ownerEmail),
])

export type Nest = typeof nests.$inferSelect
export type NewNest = typeof nests.$inferInsert

export type Chat = typeof chats.$inferSelect
export type NewChat = typeof chats.$inferInsert
export type ChatMessage = typeof chatMessages.$inferSelect
export type NewChatMessage = typeof chatMessages.$inferInsert

// ── Org / company layer (merged in from the former openape-org app, B0). ──
//
// Troop is the control plane; the org layer is the business view the Owner
// sees — the company, its people (agents), what it's working on, what it
// reports, what it costs. `org_members.agentEmail` references `agents.email`
// (the agent's DDISA identity) by value — the same string-key join troop uses
// everywhere; a hard FK is a later hardening step. Org has no external machine
// consumers, so these tables and their endpoints are owner-session only and do
// NOT touch troop's machine surface (/api/agents/me/*, nest-ws, cli/exchange).

// organizations — one row per virtual company. `visionMd` is owner-maintained
// Markdown the CEO reads on every interaction; never agent-edited.
export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  ownerEmail: text('owner_email').notNull(),
  name: text('name').notNull(),
  visionMd: text('vision_md').notNull().default(''),
  budgetMonthlyEur: integer('budget_monthly_eur').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  index('idx_org_owner').on(table.ownerEmail),
])

// org_members — agents working for this org, with hierarchy + role. `role`:
// ceo / teamlead / specialist / sanierer / other. `reportsToEmail` is the
// parent agent (null for CEO + Sanierer, who report to the Owner). The CEO is
// the Owner's primary point of contact (talk to the CEO, not down the chain).
export const orgMembers = sqliteTable('org_members', {
  orgId: text('org_id').notNull(),
  agentEmail: text('agent_email').notNull(),
  agentName: text('agent_name').notNull(),
  role: text('role').notNull(),
  persona: text('persona'),
  reportsToEmail: text('reports_to_email'),
  status: text('status').notNull().default('invited'),
  spawnedAt: integer('spawned_at'),
  retiredAt: integer('retired_at'),
  createdAt: integer('created_at').notNull(),
  // In-flight troop spawn tracking (placeholder row → real agent on success).
  spawnIntentId: text('spawn_intent_id'),
  spawnStatus: text('spawn_status'),
  spawnError: text('spawn_error'),
  spawnTroopBearer: text('spawn_troop_bearer'),
  spawnTroopBearerExpiresAt: integer('spawn_troop_bearer_expires_at'),
  spawnGrantId: text('spawn_grant_id'),
}, table => [
  primaryKey({ columns: [table.orgId, table.agentEmail] }),
  index('idx_org_members_org').on(table.orgId),
  index('idx_org_members_role').on(table.orgId, table.role),
])

// objectives — flat Kanban list of what the org is working on. CEO writes here.
export const objectives = sqliteTable('objectives', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').notNull().default('planned'),
  targetDate: integer('target_date'),
  parentId: text('parent_id'),
  createdByEmail: text('created_by_email').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  index('idx_objectives_org').on(table.orgId),
  index('idx_objectives_status').on(table.orgId, table.status),
])

// reports — markdown reports produced by agents (daily/weekly/quarterly/alert/adhoc).
export const reports = sqliteTable('reports', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  bodyMd: text('body_md').notNull(),
  generatedByEmail: text('generated_by_email').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [
  index('idx_reports_org').on(table.orgId, table.createdAt),
])

// cost_snapshots — one row per (org, day). Rolling 30 days feeds the budget check.
export const costSnapshots = sqliteTable('cost_snapshots', {
  orgId: text('org_id').notNull(),
  day: text('day').notNull(),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  inferenceCostCents: integer('inference_cost_cents').notNull().default(0),
  infraCostCents: integer('infra_cost_cents').notNull().default(0),
  outputArtifactsCount: integer('output_artifacts_count').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  primaryKey({ columns: [table.orgId, table.day] }),
])

export type Organization = typeof organizations.$inferSelect
export type NewOrganization = typeof organizations.$inferInsert
export type OrgMember = typeof orgMembers.$inferSelect
export type NewOrgMember = typeof orgMembers.$inferInsert
export type Objective = typeof objectives.$inferSelect
export type NewObjective = typeof objectives.$inferInsert
export type Report = typeof reports.$inferSelect
export type NewReport = typeof reports.$inferInsert
export type CostSnapshot = typeof costSnapshots.$inferSelect
export type NewCostSnapshot = typeof costSnapshots.$inferInsert
