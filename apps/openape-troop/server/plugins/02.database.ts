import { sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'

// Idempotent table init. Drizzle Studio + drizzle-kit are nice but our
// pattern across the openape monorepo is "CREATE TABLE IF NOT EXISTS"
// at boot — same as openape-free-idp + openape-chat — so the deploy
// pipeline doesn't need a separate migration step. New columns get
// added via ALTER TABLE in this file later if/when needed.
export default defineNitroPlugin(async () => {
  if (process.env.OPENAPE_E2E === '1') return

  try {
    const db = useDb()

    await db.run(sql`CREATE TABLE IF NOT EXISTS cockpit_services (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      base_url TEXT NOT NULL,
      tasks_path TEXT NOT NULL DEFAULT '/api/agent/tasks',
      label TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_cockpit_services_owner ON cockpit_services(owner_email)`)
    await db.run(sql`CREATE TABLE IF NOT EXISTS cockpit_agents (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      org_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'specialist',
      label TEXT NOT NULL DEFAULT '',
      duties TEXT NOT NULL DEFAULT '',
      procedure TEXT NOT NULL DEFAULT '',
      vars TEXT NOT NULL DEFAULT '{}',
      injection_score REAL NOT NULL DEFAULT 0,
      injection_reason TEXT NOT NULL DEFAULT '',
      tools TEXT NOT NULL DEFAULT '[]',
      reports_to TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_cockpit_agents_org ON cockpit_agents(owner_email, org_id)`)
    // Cockpit procedures (#930): the role's work instruction + its own facts
    // live in troop, not in a file on the operator's disk.
    try { await db.run(sql`ALTER TABLE cockpit_agents ADD COLUMN procedure TEXT NOT NULL DEFAULT ''`) }
    catch { /* column exists */ }
    try { await db.run(sql`ALTER TABLE cockpit_agents ADD COLUMN vars TEXT NOT NULL DEFAULT '{}'`) }
    catch { /* column exists */ }
    try { await db.run(sql`ALTER TABLE cockpit_agents ADD COLUMN injection_score REAL NOT NULL DEFAULT 0`) }
    catch { /* column exists */ }
    try { await db.run(sql`ALTER TABLE cockpit_agents ADD COLUMN injection_reason TEXT NOT NULL DEFAULT ''`) }
    catch { /* column exists */ }
    // memory — company/role/agent-scoped facts the Operator reads (Memory feature).
    await db.run(sql`CREATE TABLE IF NOT EXISTS memory (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      org_id TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'company',
      target_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'inline',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_memory_org_scope ON memory(org_id, scope)`)
    // cockpit_skills — reusable named procedures assigned to agents (Skills feature).
    await db.run(sql`CREATE TABLE IF NOT EXISTS cockpit_skills (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL DEFAULT '',
      assigned_to TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_cockpit_skills_org ON cockpit_skills(org_id)`)
    await db.run(sql`CREATE TABLE IF NOT EXISTS cockpit_schedules (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      org_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      at_hour INTEGER,
      every_minutes INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at INTEGER,
      created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_cockpit_schedules_owner ON cockpit_schedules(owner_email)`)
    // Proactive triggers (#proactive-operators): `prompt` = what the Operator does
    // when due; `fire_at` = one-shot timer alternative to at_hour/every_minutes.
    try { await db.run(sql`ALTER TABLE cockpit_schedules ADD COLUMN prompt TEXT NOT NULL DEFAULT ''`) }
    catch { /* column exists */ }
    try { await db.run(sql`ALTER TABLE cockpit_schedules ADD COLUMN fire_at INTEGER`) }
    catch { /* column exists */ }
    // Self-scheduling (#proactive-operators Phase 3): who created this trigger.
    try { await db.run(sql`ALTER TABLE cockpit_schedules ADD COLUMN created_by TEXT NOT NULL DEFAULT 'owner'`) }
    catch { /* column exists */ }
    // Event hooks (#proactive-operators Phase 2): external POST /api/hooks/<token>
    // fires the Operator on the same spine as schedules.
    await db.run(sql`CREATE TABLE IF NOT EXISTS cockpit_hooks (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      org_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      token TEXT NOT NULL UNIQUE,
      secret TEXT,
      prompt TEXT NOT NULL DEFAULT '',
      include_payload INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL DEFAULT 'owner',
      last_fired_at INTEGER,
      created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_cockpit_hooks_owner ON cockpit_hooks(owner_email)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_cockpit_hooks_token ON cockpit_hooks(token)`)
    try { await db.run(sql`ALTER TABLE cockpit_hooks ADD COLUMN created_by TEXT NOT NULL DEFAULT 'owner'`) }
    catch { /* column exists */ }
    await db.run(sql`CREATE TABLE IF NOT EXISTS cockpit_chat_messages (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      org_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_cockpit_chat_owner_org ON cockpit_chat_messages(owner_email, org_id, created_at)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_push_subs_owner ON push_subscriptions(owner_email)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS agents (
      email TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      host_id TEXT,
      hostname TEXT,
      pubkey_ssh TEXT,
      system_prompt TEXT NOT NULL DEFAULT '',
      first_seen_at INTEGER,
      last_seen_at INTEGER,
      created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner_email)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_agents_host ON agents(host_id)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS tasks (
      agent_email TEXT NOT NULL,
      task_id TEXT NOT NULL,
      name TEXT NOT NULL,
      cron TEXT NOT NULL,
      user_prompt TEXT NOT NULL DEFAULT '',
      tools TEXT NOT NULL,
      max_steps INTEGER NOT NULL DEFAULT 10,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (agent_email, task_id)
    )`)

    // Idempotent migration block — runs every boot but each ALTER is
    // wrapped in try/catch since SQLite has no IF NOT EXISTS for column
    // ops. The point: agents created before the system-prompt refactor
    // (#346) stay readable, and existing pre-refactor task rows keep
    // their content (the per-task system_prompt becomes user_prompt).
    try {
      await db.run(sql`ALTER TABLE agents ADD COLUMN system_prompt TEXT NOT NULL DEFAULT ''`)
    }
    catch { /* column exists */ }
    // Phase H: tool whitelist per agent. Default '[]' for existing
    // pre-refactor rows; new agents land via the sync.post handler
    // which writes the all-tools list.
    try {
      await db.run(sql`ALTER TABLE agents ADD COLUMN tools TEXT NOT NULL DEFAULT '[]'`)
    }
    catch { /* column exists */ }
    // Agent Recipe M5: owner-editable behaviour layer appended to the
    // system prompt at sync (no re-deploy).
    try {
      await db.run(sql`ALTER TABLE agents ADD COLUMN user_addendum TEXT NOT NULL DEFAULT ''`)
    }
    catch { /* column exists */ }
    // Agent Recipe tools/ (piece b): the <repo>@<ref> the agent was
    // deployed from; the agent checks out its tools/ from it.
    try {
      await db.run(sql`ALTER TABLE agents ADD COLUMN recipe_ref TEXT`)
    }
    catch { /* column exists */ }
    // The nest an agent belongs to (recorded at spawn from the spawning nest).
    try {
      await db.run(sql`ALTER TABLE agents ADD COLUMN nest_host_id TEXT`)
    }
    catch { /* column exists */ }
    // Owner-set pause mirror (enforcement lives on the nest; this drives the UI badge).
    try {
      await db.run(sql`ALTER TABLE agents ADD COLUMN paused INTEGER NOT NULL DEFAULT 0`)
    }
    catch { /* column exists */ }
    await db.run(sql`CREATE TABLE IF NOT EXISTS agent_skills (
      agent_email TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      body TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (agent_email, name)
    )`)
    try {
      await db.run(sql`ALTER TABLE tasks RENAME COLUMN system_prompt TO user_prompt`)
    }
    catch { /* already renamed, or table created fresh with user_prompt */ }
    try {
      await db.run(sql`ALTER TABLE tasks ADD COLUMN user_prompt TEXT NOT NULL DEFAULT ''`)
    }
    catch { /* column exists (either via fresh create or from rename above) */ }
    // Deterministic command tasks: the cron-runner runs `command` via the
    // gated ape-shell path instead of an LLM turn. Nullable — chat-style
    // tasks leave it unset and fall back to user_prompt.
    try {
      await db.run(sql`ALTER TABLE tasks ADD COLUMN command TEXT`)
    }
    catch { /* column exists */ }

    await db.run(sql`CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      agent_email TEXT NOT NULL,
      task_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      status TEXT NOT NULL,
      final_message TEXT,
      step_count INTEGER,
      trace TEXT
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_runs_agent_task ON runs(agent_email, task_id)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at)`)

    // Agent Recipe M2c: capability broker. pubkey_x25519 = agent's
    // encryption pubkey (reported on sync); agent_secrets holds
    // sealed-at-rest capability values (plaintext never stored).
    try {
      await db.run(sql`ALTER TABLE agents ADD COLUMN pubkey_x25519 TEXT`)
    }
    catch { /* column exists */ }
    await db.run(sql`CREATE TABLE IF NOT EXISTS agent_secrets (
      agent_email TEXT NOT NULL,
      env TEXT NOT NULL,
      sealed TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      revoked_at INTEGER,
      PRIMARY KEY (agent_email, env)
    )`)

    // ChatGPT (and future) OAuth device-flow state + connection status. The
    // sealed credential itself lives in agent_secrets (CHATGPT_AUTH_JSON);
    // this table is only the flow/UI state. (ape-plan 01KTCBFW M1/S2.)
    await db.run(sql`CREATE TABLE IF NOT EXISTS oauth_credentials (
      agent_email TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      device_code TEXT,
      user_code TEXT,
      verification_uri TEXT,
      device_expires_at INTEGER,
      account_id TEXT,
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (agent_email, provider)
    )`)

    // chats — one persistent "main session" per (owner, agent) pair.
    // Lazily inserted on first message either side sends.
    await db.run(sql`CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      agent_email TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_message_at INTEGER
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_chats_owner_agent
      ON chats (owner_email, agent_email)`)

    // chat_messages — the conversation log. role='human'|'agent'.
    // streaming=true while the agent's bridge is streaming a response
    // (PATCH updates the row in place without bumping edited_at).
    await db.run(sql`CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      edited_at INTEGER,
      streaming INTEGER NOT NULL DEFAULT 0,
      streaming_status TEXT,
      reply_to TEXT
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_created
      ON chat_messages (chat_id, created_at)`)

    // nests — devices (pods) bound to an Owner (M4δ). host_id is
    // owner-scoped, so the PK is (owner_email, host_id). status flips
    // to 'revoked' on DELETE rather than hard-deleting.
    await db.run(sql`CREATE TABLE IF NOT EXISTS nests (
      owner_email TEXT NOT NULL,
      host_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      pod_uuid TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER,
      device_secret_hash TEXT,
      PRIMARY KEY (owner_email, host_id)
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_nests_owner ON nests(owner_email)`)
    // device_secret_hash was added after the initial nests CREATE; ALTER is
    // idempotent-by-try (SQLite has no ADD COLUMN IF NOT EXISTS).
    try {
      await db.run(sql`ALTER TABLE nests ADD COLUMN device_secret_hash TEXT`)
    }
    catch { /* column already exists */ }
    // last_ip: captured from the WS upgrade on `hello` (added after nests).
    try {
      await db.run(sql`ALTER TABLE nests ADD COLUMN last_ip TEXT`)
    }
    catch { /* column already exists */ }

    // ── Org / company layer (B0 merge). Additive tables only — owner-session
    // surface, no overlap with the machine tables above. ──
    await db.run(sql`CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      name TEXT NOT NULL,
      vision_md TEXT NOT NULL DEFAULT '',
      budget_monthly_eur INTEGER NOT NULL DEFAULT 0,
      vars TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_org_owner ON organizations(owner_email)`)
    // Cockpit procedures (#930): company-wide facts shared by every employee.
    try { await db.run(sql`ALTER TABLE organizations ADD COLUMN vars TEXT NOT NULL DEFAULT '{}'`) }
    catch { /* column exists */ }

    await db.run(sql`CREATE TABLE IF NOT EXISTS org_members (
      org_id TEXT NOT NULL,
      agent_email TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      role TEXT NOT NULL,
      persona TEXT,
      reports_to_email TEXT,
      status TEXT NOT NULL DEFAULT 'invited',
      spawned_at INTEGER,
      retired_at INTEGER,
      created_at INTEGER NOT NULL,
      spawn_intent_id TEXT,
      spawn_status TEXT,
      spawn_error TEXT,
      spawn_troop_bearer TEXT,
      spawn_troop_bearer_expires_at INTEGER,
      spawn_grant_id TEXT,
      PRIMARY KEY (org_id, agent_email)
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members(org_id)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_org_members_role ON org_members(org_id, role)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS objectives (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'planned',
      target_date INTEGER,
      parent_id TEXT,
      created_by_email TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_objectives_org ON objectives(org_id)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_objectives_status ON objectives(org_id, status)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body_md TEXT NOT NULL,
      generated_by_email TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_reports_org ON reports(org_id, created_at)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS cost_snapshots (
      org_id TEXT NOT NULL,
      day TEXT NOT NULL,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      inference_cost_cents INTEGER NOT NULL DEFAULT 0,
      infra_cost_cents INTEGER NOT NULL DEFAULT 0,
      output_artifacts_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (org_id, day)
    )`)
  }
  catch (err) {
    console.error('[troop/database] table init failed:', err)
  }
})
