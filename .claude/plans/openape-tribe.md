# Feature: openape-tribe — small cron-driven agents tied to a central SP

## Purpose

`apes agents spawn` is the only way to provision an OpenApe agent today, and it bootstraps a full macOS user account, a launchd daemon for `chat-bridge` driven by an external `pi-coding-agent` runtime (cloned + bun-installed per spawn), a Claude Code installation, and ape-shell as the login shell. That's the right shape for a "personal computer agent" but way too much for the common case: a tiny scheduled worker that runs a focused task, calls LiteLLM with a fixed tool set, reports a run, exits — and the pi dependency adds substantial bootstrap cost and gives away control of the agent loop.

This feature does three things at once:

1. Adds a thin SP at `tribe.openape.ai` where the user manages those small agents from any device.
2. Ships a small **agent runtime** in the apes CLI (`apes agents run` for cron + `apes agents serve --rpc` for chat-bridge) — both modes share one tool-call loop.
3. Sunsets `pi-coding-agent`: chat-bridge swaps its subprocess from `pi --mode rpc` to `apes agents serve --rpc`. We own the loop, the tool spec, and the streaming protocol.

`apes agents spawn` keeps creating the full macOS user — but every spawned agent now also enrolls at the tribe SP, gets a sync launchd, and picks up cron-scheduled tasks the user defines server-side. Spawn time drops noticeably (no more pi clone + bun install).

**Trigger:** the heavy spawn shape is the only on-ramp today; the user wants a "small cron agent" pattern without abandoning the OS-user model, and the pi dependency feels like ceded control we don't actually need. Tribe = the central place to define + steer tasks. The runtime = the small piece that finally makes us self-contained.

---

## Progress

- [ ] Milestone 1: Tribe SP scaffold + DB schema + deploy pipeline
- [ ] Milestone 2: SP API endpoints (agent-side + owner-side)
- [ ] Milestone 3: Tribe web UI (list agents, manage tasks, view runs)
- [ ] Milestone 4: `apes agents sync` — pull config, reconcile launchd plists
- [ ] Milestone 5: `apes agents run` (one-shot) + `apes agents serve --rpc` (long-running) — runtime + built-in tools
- [ ] Milestone 6: `apes agents spawn` integration — register at tribe + install sync launchd; drop pi install path
- [ ] Milestone 7: DNS + cert + go-live + initial dogfood agent
- [ ] Milestone 8: chat-bridge migration — swap `pi --mode rpc` subprocess for `apes agents serve --rpc`, drop `pi-coding-agent` dependency

---

## Decision Log

| Datum | Entscheidung | Begründung |
|---|---|---|
| 2026-05-08 | **Local-only execution** | Tools need filesystem + shell access on the agent's host. Server-side run would gut the model. Trade-off: agent dies when host is off — acceptable for personal-computer agents. |
| 2026-05-08 | **Fixed per-task tool list** | Declared statically in the task spec (`tools: ['mail.list', 'http.get']`). Not on-demand grant negotiation — keeps the run loop simple and the user in control via the SP web UI. |
| 2026-05-08 | **Identity reuses `apes agents enroll` model** | Agent gets its own DDISA-agent-account `agent+<name>+<owner-domain>@id.openape.ai` (existing pattern). Tribe SP authenticates via that JWT for agent-side endpoints; owner uses their own user JWT for management endpoints. |
| 2026-05-08 | **Extend `apes agents` first, defer dedicated `tribe` CLI** | Avoids a parallel CLI surface. Endpoint defaults to `https://tribe.openape.ai`, env var `OPENAPE_TRIBE_URL` overrides for staging/dev. A `tribe` shell alias can be added later as cosmetic sugar. |
| 2026-05-08 | **launchd plists, one per task** | macOS standard. Atomic per-sync swap (drop the whole `~/Library/LaunchAgents/openape.tribe.<name>.<task>.plist` set, write the new set, `launchctl bootstrap`/`bootout` to apply). Crontab is deprecated, plus `apes agents spawn` already speaks launchd for the bridge. |
| 2026-05-08 | **Tools are built into the apes package** | New tool = code change + apes release. Trade-off: less flexible than dynamic plugins, but the resolver is trivial (string → function), agent owners can't accidentally grant scary unaudited tools, and there's no plugin-loading attack surface. |
| 2026-05-08 | **SP shows per-agent: email · hostname · public SSH key · crons · system prompt · tools per task** | Owner-visibility requirement. Hostname comes from agent self-report on each sync; pubkey is already known via the IdP's SSH-key store. |
| 2026-05-08 | **Run reporting: structured minimum + truncated tool trace** | `started_at`, `finished_at`, `status`, `final_message`, `step_count`, plus a JSON `trace` field with tool calls capped at ~16KB. Owner needs at least "did it run, did it succeed, what did it say last" — that's the floor. |
| 2026-05-08 | **`apes agents spawn` keeps full-macOS-user behaviour** | New behaviour layered on top: register at tribe + install sync launchd. The "lightweight no-OS-user agent" variant is explicitly out-of-scope for v1. |
| 2026-05-08 | **Multi-host: 1:1 agent ↔ host, hostId via Mac-Hardware-UUID** | Each `apes agents spawn` produces a new agent identity bound to the host it ran on. IdP rejects email collisions, so a second host has to use a different agent name (`alice-laptop`, `alice-mini`). At first sync the agent reports `hostname` (mutable, human-readable) plus `hostId` derived from `IOPlatformUUID` (stable, hardware-rooted). Tribe pins `hostId` after first sync — subsequent syncs from a different `hostId` for the same agent JWT are rejected with 401. That's the cheap "the keypair was copied to another machine" alarm. |
| 2026-05-08 | **Tribe runtime replaces `@mariozechner/pi-coding-agent`** | Today `apes agents spawn --bridge` clones pi, `bun install`s it, writes a litellm extension, and chat-bridge runs `pi --mode rpc` per room. With our own runtime in M5 we can offer the same RPC contract (`{ session_id, user_msg }` in, `text_delta`/`done` events out) — chat-bridge swaps subprocess from pi to `apes agents serve --rpc`. Eliminates pi clone + bun install + extension write from the spawn flow, and gives us full control over the tool spec + streaming events. |

---

## Surprises & Discoveries

_(Filled during implementation.)_

---

## Context & Orientation

### Existing pieces we're reusing

- **`apes agents enroll`** (`packages/apes/src/lib/agent-bootstrap.ts`) issues an Ed25519 keypair, registers the agent at the IdP (`/api/admin/agents`), gets back an agent JWT with `act:'agent'`. We reuse this verbatim — every tribe agent IS a DDISA agent.
- **`@openape/cli-auth`** (`~/.config/apes/auth.json`) holds the owner's IdP token. Tribe is just another SP that exchanges it for a tribe-scoped token via the standard `/api/cli/exchange` flow already used by `ape-plans`/`ape-tasks`.
- **`@openape/nuxt-auth-sp`** module gives us the SP boilerplate (login, callback, /api/me, session cookies). Same pattern as plans/tasks/preview.
- **`apes agents spawn`'s launchd writer** (`packages/apes/src/lib/llm-bridge.ts:bridgePlistPath` etc) — there's an existing template for building plist files. Reuse the helper, point it at the tribe sync + run scripts instead of the bridge.

### What's actually new

- A new app `apps/openape-tribe` (Nuxt + Drizzle, mirrors `apps/openape-plans` shape) at `tribe.openape.ai`
- Three new Drizzle tables (`agents`, `tasks`, `runs`)
- New `apes agents sync` and `apes agents run` subcommands in the apes CLI
- A built-in tool registry `packages/apes/src/lib/agent-tools/` mapped from string names to functions
- A launchd-plist reconciler that diffs server-side tasks against installed plists

### Threat model

- **Agent JWT compromised** → attacker can read the agent's tasks (system prompts, tool list) and post fake run reports. Cannot create or delete tasks (those need the owner JWT). Same blast radius as a compromised `agent+name+...` account today.
- **Owner-laptop compromised** → attacker has the owner's apes-token, can mint new agent identities, install arbitrary tasks. Identical to today's `apes agents` surface.
- **Tribe SP compromised** → attacker can edit task system-prompts and tool lists. Agent's tool registry is built-in (bounded); attacker can't smuggle a brand-new "delete-everything" tool. Worst case: phishing-via-system-prompt, or driving a tool we shipped to do something the owner didn't intend.
- **Mitigation gap (accepted for v1):** no signed task-definitions. A future iteration could have the owner sign tasks client-side and the agent verify before running. Out of scope here.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  tribe.openape.ai (apps/openape-tribe — Nuxt SP)             │
│                                                              │
│  Web UI                                                      │
│   ├─ /agents               my agents (table, last-seen)     │
│   ├─ /agents/:name         tasks editor + run history       │
│   └─ /agents/:name/runs    run detail (trace, errors)        │
│                                                              │
│  API                                                         │
│   ├─ owner-auth (user JWT via @openape/nuxt-auth-sp)         │
│   │  ├─ GET    /api/agents                                   │
│   │  ├─ GET    /api/agents/:name                             │
│   │  ├─ POST   /api/agents/:name/tasks                       │
│   │  ├─ PUT    /api/agents/:name/tasks/:taskId               │
│   │  ├─ DELETE /api/agents/:name/tasks/:taskId               │
│   │  └─ GET    /api/agents/:name/runs                        │
│   └─ agent-auth (DDISA agent JWT, sub=agent+name+…)          │
│      ├─ POST  /api/agents/me/sync       upsert hostname/keys │
│      ├─ GET   /api/agents/me/tasks      pull task list       │
│      └─ POST  /api/agents/me/runs       push run record      │
│                                                              │
│  Drizzle (LibSQL)                                            │
│   ├─ agents (email PK, owner_email, hostname, pubkey, …)     │
│   ├─ tasks  (PK (agent_email, task_id), cron, sys_prompt,    │
│   │         tools[], max_steps, enabled)                     │
│   └─ runs   (id PK, agent_email, task_id, started_at,        │
│             finished_at, status, final_message, trace_json)  │
└──────────────────────────────────────────────────────────────┘
                              ▲
                              │ HTTPS (DDISA agent JWT or user JWT)
                              │
┌─────────────────────────────┴──────────────────────────────────┐
│  Agent host (macOS user provisioned by `apes agents spawn`)    │
│                                                                │
│  ~/Library/LaunchAgents/                                       │
│   ├─ openape.tribe.sync.plist           every 5min, calls     │
│   │                                     `apes agents sync`    │
│   └─ openape.tribe.<task>.plist (×N)    on cron, calls        │
│                                         `apes agents run`     │
│                                                                │
│  ~/.openape/agent/                                             │
│   ├─ agent-name                         (from $WHOAMI logic)   │
│   ├─ agent-jwt.json                     (DDISA agent token)    │
│   └─ tasks/<task_id>.json               (synced from server)   │
│                                                                │
│  apes CLI                                                      │
│   ├─ apes agents sync                                          │
│   │   1. Self-introduce: POST /api/agents/me/sync (hostname)  │
│   │   2. Fetch tasks:    GET  /api/agents/me/tasks            │
│   │   3. Reconcile:      diff against ~/Library/LaunchAgents/  │
│   │   4. Apply:          launchctl bootstrap/bootout            │
│   │                                                            │
│   └─ apes agents run <task_id>                                 │
│       1. Load task spec from ~/.openape/agent/tasks/<id>.json  │
│       2. Build LiteLLM messages: [system_prompt, user_trigger] │
│       3. Tool-call loop until done or max_steps                │
│       4. POST /api/agents/me/runs (status, trace)              │
└────────────────────────────────────────────────────────────────┘
```

---

## Milestone 1 — Tribe SP scaffold + DB schema + deploy pipeline

**Goal:** `https://tribe.openape.ai` returns 200 logged-out, 302 to login when accessed without a session, schema migrations idempotently bring up three tables.

**Files to create:**
- `apps/openape-tribe/` — Nuxt 4 app, copy structure from `apps/openape-plans/app/`
  - `package.json` — `@openape/nuxt-auth-sp@workspace:*`, `drizzle-orm`, `@libsql/client`
  - `nuxt.config.ts` — `openapeSp: { spName: 'OpenApe Tribe', clientId: 'tribe.openape.ai', fallbackIdpUrl: 'https://id.openape.ai' }`
  - `server/database/drizzle.ts` — same shape as `apps/openape-free-idp/server/database/drizzle.ts`
  - `server/database/schema.ts` — see schema below
  - `server/plugins/02.database.ts` — `CREATE TABLE IF NOT EXISTS …` for the three tables
  - `app/pages/login.vue` — drop-in `<OpenApeAuth />` + `<OpenApeOAuthErrorAlert />`
  - `app/pages/index.vue` — temporary "tribe is live" landing page
- `.github/workflows/deploy-tribe.yml` — copy `deploy-chat.yml`, swap paths/service-name/health-URL
- `scripts/deploy-tribe.sh` — copy `scripts/deploy-chat.sh`, swap `openape-tribe`

**Schema:**

```ts
// agents — one row per registered agent. PK is the agent's email
// (DDISA-style `agent+name+ownerdomain@id.openape.ai`). The IdP
// guarantees email uniqueness, so two `apes agents spawn alice` calls
// from different hosts will be rejected at IdP-enroll time before they
// reach tribe — owner picks distinct names like `alice-laptop` /
// `alice-mini` for multi-host. `hostId` is the stable hardware-rooted
// identifier (Mac IOPlatformUUID), pinned at first sync; mismatched
// later syncs get 401. `hostname` is the human-readable name and is
// allowed to change.
export const agents = sqliteTable('agents', {
  email: text('email').primaryKey(),               // agent+name+domain@id.openape.ai
  ownerEmail: text('owner_email').notNull(),       // patrick@hofmann.eco
  agentName: text('agent_name').notNull(),         // 'alice-laptop'
  hostId: text('host_id'),                         // IOPlatformUUID, pinned at first sync
  hostname: text('hostname'),                      // os.hostname(), refreshed each sync
  pubkeySsh: text('pubkey_ssh'),                   // OpenSSH format, from IdP
  firstSeenAt: integer('first_seen_at'),           // timestamp of first sync
  lastSeenAt: integer('last_seen_at'),             // timestamp of most recent sync
  createdAt: integer('created_at').notNull(),
}, table => [
  index('idx_agents_owner').on(table.ownerEmail),
  index('idx_agents_host').on(table.hostId),
])

// tasks — agent's cron-scheduled jobs. Composite PK (agent, task).
export const tasks = sqliteTable('tasks', {
  agentEmail: text('agent_email').notNull(),
  taskId: text('task_id').notNull(),               // slug: 'mail-triage'
  name: text('name').notNull(),                    // display
  cron: text('cron').notNull(),                    // launchd uses calendar-interval; we'll
                                                   // accept "*/5 * * * *" and translate
  systemPrompt: text('system_prompt').notNull(),
  tools: text('tools', { mode: 'json' }).notNull(),// string[]
  maxSteps: integer('max_steps').notNull().default(10),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  primaryKey({ columns: [table.agentEmail, table.taskId] }),
])

// runs — execution history. id is uuid, indexed by (agent, task) for queries.
export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  agentEmail: text('agent_email').notNull(),
  taskId: text('task_id').notNull(),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  status: text('status').notNull(),                // 'running' | 'ok' | 'error'
  finalMessage: text('final_message'),
  stepCount: integer('step_count'),
  trace: text('trace', { mode: 'json' }),          // truncated to ~16KB
}, table => [
  index('idx_runs_agent_task').on(table.agentEmail, table.taskId),
  index('idx_runs_started').on(table.startedAt),
])
```

**Acceptance:**
- [ ] `pnpm turbo run build --filter=openape-tribe` succeeds
- [ ] `node .output/server/index.mjs` locally serves `/login` (HTTP 200)
- [ ] After deploy: `curl -o /dev/null -w '%{http_code}' https://tribe.openape.ai/` → 200, `/login` → 200
- [ ] DB plugin creates the three tables on first boot (verified via `select name from sqlite_master where type='table'` on the Turso instance)

---

## Milestone 2 — SP API endpoints

**Goal:** Owner can curl their agents + tasks with their user JWT; agent can curl its own tasks with its agent JWT.

**Files:**
- `apps/openape-tribe/server/api/agents/`
  - `index.get.ts` — list owner's agents (joined with most-recent run)
  - `[name].get.ts` — single agent + its tasks
  - `[name]/tasks/index.post.ts` — create task (validates cron, tools whitelist)
  - `[name]/tasks/[taskId].put.ts` — update task
  - `[name]/tasks/[taskId].delete.ts` — delete task
  - `[name]/runs/index.get.ts` — paginated run history
- `apps/openape-tribe/server/api/agents/me/`
  - `sync.post.ts` — agent self-introduces; upserts agent row with `hostname` + `hostId` + `pubkeySsh`. On first sync the `hostId` is pinned. On every subsequent sync the request body's `hostId` MUST match the pinned value, otherwise 401 (the agent's keypair was likely copied to another machine).
  - `tasks.get.ts` — agent reads its own tasks
  - `runs.post.ts` — agent posts a run record (truncates trace to 16KB)
- `apps/openape-tribe/server/utils/auth.ts` — two resolvers:
  - `requireOwner(event)` — returns owner email from session, used for the owner-side endpoints
  - `requireAgent(event)` — verifies the bearer agent JWT, returns agent email; rejects user JWTs

**Tools allowlist:** server-side validation that `tools[]` contains only known names. Read from a JSON manifest committed in the repo, e.g. `apps/openape-tribe/server/tool-catalog.json`. The runtime registry on the agent side has the actual implementations; the SP just enforces "you can't add a tool we don't know exists". Same catalog file is served to the web UI for the picker.

**Acceptance:**
- [ ] `curl -H "Authorization: Bearer $USER_JWT" tribe.openape.ai/api/agents` returns `[]` initially, then a row after `agents/me/sync` is called
- [ ] `curl -H "Authorization: Bearer $AGENT_JWT" tribe.openape.ai/api/agents/me/tasks` returns `[]` for a fresh agent
- [ ] Owner can POST a task, agent can GET it back via `/me/tasks` — sub-claim resolution works
- [ ] User JWT rejected (403) on `/me/*` endpoints; agent JWT rejected (403) on `/agents/:name/tasks` mutations

---

## Milestone 3 — Tribe web UI

**Goal:** Owner can manage agents end-to-end in the browser without curl.

**Files:**
- `apps/openape-tribe/app/pages/agents/index.vue`
  - Table: agent name, email, **hostname + hostId** (compact), pubkey-fingerprint, last-seen, task-count, "manage" link
  - Owner sees only their own agents
- `apps/openape-tribe/app/pages/agents/[name].vue`
  - Agent header (email, hostname, hostId, pubkey, first sync, last sync)
  - Tasks list with edit/delete inline
  - "New task" form: name, cron string, system prompt (multiline), tool picker (multi-select from catalog), max-steps (1–50)
  - "Recent runs" — last 20, status badges, click to expand trace
- `apps/openape-tribe/app/pages/login.vue` — `<OpenApeOAuthErrorAlert />` with tribe-specific copy
- `apps/openape-tribe/app/components/CronInput.vue` — input + live "next run at" preview using a tiny cron parser (`cron-parser` ~5KB)
- `apps/openape-tribe/app/components/ToolPicker.vue` — fetches the catalog, multi-select with descriptions

**Acceptance:**
- [ ] Logged-in owner with no agents sees an empty state with a "register an agent" hint linking to `apes agents spawn` docs
- [ ] After running `apes agents sync` once on a host, that agent appears in `/agents` with the correct hostname + pubkey
- [ ] Creating a task in the browser → next `apes agents sync` on the host → launchd plist is written, `launchctl print` shows the job
- [ ] Run history table shows fresh rows after a task fires; clicking a row shows the trace

---

## Milestone 4 — `apes agents sync` (CLI subcommand)

**Goal:** Running `apes agents sync` on an agent's macOS user reconciles `~/Library/LaunchAgents/openape.tribe.*.plist` with the server-side task list.

**Files:**
- `packages/apes/src/commands/agents/sync.ts` — new citty command
- `packages/apes/src/lib/tribe-client.ts` — typed wrapper around tribe API (sync, tasks, runs)
- `packages/apes/src/lib/launchd-reconcile.ts` — diff + apply

**Behaviour:**
1. Load agent JWT from `~/.openape/agent/agent-jwt.json` (issued by `apes agents enroll`)
2. POST `/api/agents/me/sync` with `{ hostname: os.hostname(), hostId: ioPlatformUuid(), pubkeySsh }`. `ioPlatformUuid()` shells out to `ioreg -d2 -c IOPlatformExpertDevice` and parses `IOPlatformUUID` (Mac-only; helper lives in `packages/apes/src/lib/macos-host.ts`). Server pins `hostId` on first sync; subsequent syncs with a different `hostId` get 401 (probable keypair theft → operator gets a clear signal).
3. GET `/api/agents/me/tasks`. Server returns task list.
4. Write each task's spec to `~/.openape/agent/tasks/<task_id>.json` (so `apes agents run` can read it without going to network)
5. Generate a launchd plist per task at `~/Library/LaunchAgents/openape.tribe.<agent_name>.<task_id>.plist`. plist runs `apes agents run <task_id>` with `StartCalendarInterval` derived from the cron string.
6. Diff: existing plists in `~/Library/LaunchAgents/openape.tribe.<agent_name>.*` minus desired plists → `launchctl bootout` + `rm`
7. New or changed plists → write file, then `launchctl bootstrap gui/$UID …`
8. `enabled: false` tasks → write the plist but `launchctl bootout` it (so it's there for visibility but inactive)

**Cron-to-launchd translation:** start with a small subset that covers 95% of use cases — `*/N * * * *`, `0 */N * * *`, `0 H * * *`, `0 H * * D`. Anything more exotic → reject server-side at task-create time. Document the supported syntax in the web UI cron-input help text.

**Files left untouched if no diff:** plist mtime + content compared, no churn unless something actually changed. Avoids unnecessary `launchctl` traffic.

**Acceptance:**
- [ ] On a fresh agent host, after creating one task in the web UI, `apes agents sync` writes one plist and `launchctl print gui/$UID/openape.tribe.alice.mail-triage` prints the job
- [ ] Deleting the task in the web UI + re-running sync → plist gone, `launchctl print` returns "could not find …"
- [ ] Editing the cron in the web UI + re-running sync → new `StartCalendarInterval`, job still loaded
- [ ] Running sync twice with no server changes → second run is a no-op (no `launchctl` calls)

---

## Milestone 5 — runtime (one-shot + RPC modes)

**Goal:** Two entry points share one tool-loop implementation: the cron-invoked one-shot, and the long-running RPC mode that chat-bridge will subprocess (replacing today's `pi --mode rpc`).

**Files:**
- `packages/apes/src/commands/agents/run.ts` — citty command, **one-shot mode**
- `packages/apes/src/commands/agents/serve.ts` — citty command, **RPC mode** (`apes agents serve --rpc`)
- `packages/apes/src/lib/agent-runtime.ts` — the loop (~150 LOC), called by both commands
  1. Resolve `spec.tools[]` against the built-in registry — fail loudly if any name unknown
  2. LiteLLM call (`POST $LITELLM_BASE_URL/v1/chat/completions`) with messages + tools
  3. If response has `tool_calls`: execute each, append results to messages, loop
  4. Stop when no tool_calls in response OR `step_count >= max_steps`
- `packages/apes/src/lib/agent-tools/` — the built-in tools:
  - `index.ts` — `export const TOOLS: Record<string, ToolFn>` registry
  - `http.ts` — `http.get`, `http.post` (no headers/body restriction beyond a 1MB cap)
  - `file.ts` — `file.read`, `file.write` within the agent's home dir only (path traversal check)
  - `ape-tasks.ts` — `tasks.list`, `tasks.create` via the existing `@openape/ape-tasks` SDK
  - `mail.ts` — `mail.list`, `mail.search` via o365-cli (only present if installed; `tools.has(name)` filters on absence)
  - `time.ts` — `time.now` (trivial; useful sanity check for first agent)
- LiteLLM client — `LITELLM_BASE_URL` from env (already populated by `apes agents spawn`'s `~/litellm/.env` integration); model from task spec (default `claude-haiku-4-5`)

**Tool-shape:** each tool registers its OpenAI tool-spec JSON alongside its implementation. Built into the apes binary, not loaded dynamically.

### Mode 1 — `apes agents run <task_id>` (one-shot, cron-invoked)

1. Load `~/.openape/agent/tasks/<task_id>.json` (task spec)
2. Build messages: `[{ role: 'system', content: spec.system_prompt }]`
3. POST a `runs` record with `status: 'running'` to `/api/agents/me/runs` to claim a run-id
4. Run the shared tool-loop
5. PATCH the run record with final state (`status` `ok`/`error`, `final_message`, `step_count`, truncated trace)
6. Exit

### Mode 2 — `apes agents serve --rpc` (long-running, stdio)

Replaces `pi --mode rpc` for chat-bridge. Stdio protocol — line-delimited JSON in both directions.

**Inbound** (one line per request):
```json
{ "type": "message", "session_id": "<roomId>:<threadId>", "system_prompt": "...", "tools": ["http.get"], "max_steps": 10, "user_msg": "what's 7×6?" }
```

**Outbound** (multiple lines per request, terminated by `done`):
```json
{ "type": "text_delta", "session_id": "...", "delta": "42" }
{ "type": "tool_call", "session_id": "...", "name": "http.get", "args": {...} }
{ "type": "tool_result", "session_id": "...", "name": "http.get", "result": "..." }
{ "type": "done", "session_id": "...", "step_count": 1, "status": "ok" }
```

The serve process keeps an in-memory `Map<session_id, Message[]>` so `(roomId, threadId)` conversations have memory across messages — same UX as today's pi-driven bridge. Sessions evicted after 1h idle. No persistence to disk (matches pi's behaviour; we accept conversation loss on restart).

LiteLLM streaming events (`text_delta` from the OpenAI streaming format) are passed through unchanged. Tool calls are executed inline; the model sees the result before the next stream chunk.

**Failure modes pinned:**
- LiteLLM 4xx/5xx → in `run`: run record `status: 'error'`, `final_message: <error>`, exit 1 (launchd logs it). In `serve`: emit `{ "type": "error", "session_id": "...", "message": "..." }` then `{ "type": "done", ..., "status": "error" }` and keep the process alive for the next inbound message.
- Tool throws → captured into trace / serialised into the model's next turn so it can self-correct or give up
- max_steps hit without `done` → `status: 'error'`, `final_message: 'max_steps reached'`
- Network down (run mode) → run record can't be posted; write to `~/.openape/agent/runs-pending/<id>.json`, next sync flushes them. (May defer to a later milestone if complex; if so, fail loud.)

**Acceptance:**
- [ ] A "say hello" task (`tools: []`, `system_prompt: 'Reply with the word hello and stop.'`) run via `apes agents run` posts a `status: 'ok'` run with `final_message: 'hello'` and `step_count: 1`
- [ ] A task using `tools: ['http.get']` to fetch `https://example.com` and return the title produces a sensible run with the title in `final_message`
- [ ] Tool name not in registry → `apes agents run` aborts before the first LiteLLM call, posts `status: 'error', final_message: 'unknown tool: foo'`
- [ ] `apes agents serve --rpc` accepts two inbound messages with the same `session_id` and the second one has the first one's content in its conversation memory (proven by asking "what's 7×6?" then "and ×2?" and getting "84")
- [ ] `apes agents serve --rpc` emits `text_delta` events as LiteLLM streams (verified by piping inbound + reading outbound line-by-line in a quick integration test)

---

## Milestone 6 — `apes agents spawn` integration

**Goal:** Running `apes agents spawn alice` from a fresh shell produces a fully tribe-connected agent. Sync launchd is installed, ready to pick up tasks the owner defines server-side.

**Files (extend, don't replace):**
- `packages/apes/src/commands/agents/spawn.ts` — change step list:
  1. (existing) macOS user, keypair, IdP enroll, agent JWT, optional Claude hook
  2. (existing) optional bridge launchd — but its setup-script body is now thinner (see below)
  3. **new:** call tribe `/api/agents/me/sync` once with the agent JWT to register the agent at the SP (creates the row with hostname + hostId + pubkey)
  4. **new:** install `~/Library/LaunchAgents/openape.tribe.sync.plist` running `apes agents sync` every 300 seconds (`StartInterval: 300`)
  5. **new:** `launchctl bootstrap gui/$UID` the sync plist so it starts running immediately
- `packages/apes/src/lib/tribe-bootstrap.ts` — helper for steps 3+4 (mirrors `lib/llm-bridge.ts` shape)
- `packages/apes/src/lib/llm-bridge.ts` — **shrink:** drop the pi clone + bun-install + extension-write logic (current lines 117-152). The bridge launchd's setup script no longer needs to provision pi at all; the bridge daemon will use `apes agents serve --rpc` from the system-wide apes binary instead. M8 ships the actual chat-bridge code change; M6 is just removing the now-dead bootstrap.
- `packages/apes/src/lib/agent-bootstrap.ts:buildSpawnSetupScript` — strip the pi-related env-write + `bun install pi-coding-agent`.

**Visible change for the user:** the spawn output's final summary now includes a "🔗 Agent registered at https://tribe.openape.ai/agents/<name>" line. Spawn time drops noticeably (no more 30s pi download + bun install).

**Acceptance:**
- [ ] After `apes agents spawn alice`, the owner sees `alice` in `https://tribe.openape.ai/agents` within ~10 seconds (one sync cycle)
- [ ] `launchctl print gui/$UID/openape.tribe.sync` shows the sync job loaded and active
- [ ] Adding a task in the web UI → within 5 minutes the task plist appears in `~/Library/LaunchAgents/` (via the sync cycle)
- [ ] No `bun install` call in the spawn flow; `~/.pi/agent/` directory is not created
- [ ] `~/Library/LaunchAgents/` contains exactly two `openape.*` entries on a fresh spawn: the sync job, and (if `--bridge` was passed) the chat-bridge job — no pi-related artefacts

---

## Milestone 7 — DNS + cert + go-live + dogfood

**Goal:** `https://tribe.openape.ai` is publicly reachable, has a valid cert, and one real end-to-end agent (mine, `daily-summary`) runs against it.

**Steps:**
1. **DNS:** `exo dns add A openape.ai -n tribe -a 85.217.175.26` (chatty's IP, where the other Nuxt SPs sit)
2. **systemd unit + nginx vhost** on chatty (one-shot bootstrap script via root@chatty.delta-mind.at, mirrors test.deltamind.at bootstrap)
3. **certbot** for HTTPS, redirect HTTP→HTTPS
4. **First deploy** via the new `deploy-tribe.yml` workflow (push to main triggers, change-detection on `apps/openape-tribe/**`)
5. **Smoke test:** `curl https://tribe.openape.ai/` → 200; login flow round-trips through id.openape.ai and lands back on `/agents`
6. **Dogfood agent:** `apes agents spawn daily-summary` on my own laptop. In the web UI, create a task `daily-summary` with cron `0 18 * * *`, system prompt that calls `tasks.list` to summarise open ape-tasks, max_steps 5. Wait until 18:00, verify a run record appears and the summary lands in my OpenApe-Tasks list as a new task.

**Acceptance:**
- [ ] HTTPS clean
- [ ] One real agent visible in the UI with hostname + pubkey + at least one successful run
- [ ] Web UI usable from phone (responsive layout — Nuxt UI defaults probably fine, just check)

---

## Milestone 8 — chat-bridge migration: drop pi, drive `apes agents serve --rpc`

**Goal:** `@openape/chat-bridge` no longer depends on `@mariozechner/pi-coding-agent`. Each chat room's long-lived LLM session is now a subprocess of our own runtime, sharing the M5 tool-loop. Functionally equivalent UX (memory across messages, streaming reply); fewer moving parts.

**Files to change:**
- `apps/openape-chat-bridge/package.json` — drop `@mariozechner/pi-coding-agent` from dependencies; add `@openape/apes` (workspace ref) so the bridge can locate the binary
- `apps/openape-chat-bridge/src/llm-session.ts` (or whichever file currently invokes `pi --mode rpc`) — swap subprocess command:
  - **before:** `spawn('pi', ['--mode', 'rpc', ...])`
  - **after:** `spawn('apes', ['agents', 'serve', '--rpc'])`
- Adapt the inbound/outbound JSON wire format if pi's protocol differs from ours. Our M5 spec (line-delimited JSON, `text_delta`/`tool_call`/`tool_result`/`done`/`error`) is the authoritative shape — bridge code translates chat-bridge's internal events from/to it.
- Remove the litellm-extension write logic (it lived to teach pi how to talk to LiteLLM; our runtime calls LiteLLM directly).
- `apps/openape-chat-bridge/CHANGELOG.md` + changeset noting "BREAKING — bridge no longer requires pi installed; requires `apes` ≥ <new-version>". Major bump.

**Acceptance:**
- [ ] `apps/openape-chat-bridge/node_modules` (after `pnpm install`) does NOT contain `@mariozechner/pi-coding-agent` anywhere
- [ ] Smoke: send "what's 7×6?" then "and ×2?" in the same chat-bridge room → second reply contains "84"
- [ ] Streaming verified: reply visibly grows in real time as the bridge PATCHes its placeholder message (existing behaviour, just over our protocol now)
- [ ] One full deploy cycle (chat-bridge published, agent host re-spawned) → chat answers still work

---

## Risks

- **Cron→launchd translation rough edges.** Some users will paste exotic cron lines that don't fit the supported subset. Mitigation: server-side validation rejects them at task-create with a clear error message and a link to the supported subset doc.
- **Built-in tool surface creep.** Each new tool = code change. We'll feel pressure to add them quickly. Mitigation: gate new tool PRs on a small checklist (input validation, error handling, OpenAI tool-spec). Don't ship anything that's a foot-gun without an explicit grant flow — out of scope for v1, may need to revisit if the catalog grows past ~10 tools.
- **launchd reconciler race conditions.** If two `apes agents sync` invocations overlap (unlikely but possible during initial spawn), they could fight over plist files. Mitigation: file lock at `~/.openape/agent/sync.lock` for the duration of the reconcile.
- **Tribe SP outage = no new task pickup.** Already-installed launchd plists keep running with their last-known spec (they read from local cache `~/.openape/agent/tasks/`). New tasks/edits don't propagate until the SP is back. Acceptable for a personal-tool SP.
- **Run-record growth.** A daily agent with 365 runs/year × N tasks × N agents could grow. Mitigation: cap `runs` table at most-recent 1000 per (agent, task) — older rows pruned by a server-side cron (deferred, M7+).
- **`hostId` brittleness.** A user who reformats their Mac or restores from Time Machine onto a different machine ends up with a different `IOPlatformUUID`. Their agent will start failing sync with 401. Mitigation: clear "host changed for agent X — re-spawn or reset host pin" UX in the SP UI, plus an explicit `apes agents reset-host` CLI flow that uses the owner JWT (not the agent JWT) to clear the pin. Out of scope for v1; the 401 itself is the failure signal.
- **`apes agents serve --rpc` lifecycle.** Process crash mid-message leaves a chat-bridge subprocess in an inconsistent state. Mitigation: bridge already restarts pi-subprocesses on close; same supervisor logic carries over. Document the protocol-error path (`{ "type": "error", ..., "fatal": true }` → bridge respawns) so failures are observable.

---

## Out of Scope (for this plan)

- **Lightweight agent without macOS user** — explicitly kept the heavy spawn shape. A future iteration can add `apes agents spawn --no-os-user` for "agent that runs as my own user" but that's not v1.
- **Server-side execution** — see decision log; tools need local context.
- **Signed task definitions** — owner-side signing of system_prompt + tools to prevent SP-side tampering. Out of scope, noted in threat model.
- **Same agent identity on multiple hosts** — v1 enforces 1:1 (IdP rejects email collision; owner picks distinct names like `alice-laptop` / `alice-mini`). If we ever want one identity to span hosts, schema needs an `agent_hosts` table — explicitly deferred.
- **Tribe CLI alias** (`tribe spawn …`) — defer until `apes agents` is mature; symbolic alias is trivial when the time comes.
- **Web push from tribe** — getting an iOS push when an agent run errored. Nice-to-have, not blocking. Could reuse the chat-bridge VAPID infra.
- **Agent-to-agent messaging** — out of scope; agents talk to LiteLLM and tools, not each other.

---

## Verification commands (handy for session-handoff)

```bash
# Build & boot tribe locally
cd apps/openape-tribe && pnpm dev
open http://localhost:3001

# Probe API endpoints (replace tokens)
USER_JWT=$(jq -r .id_token ~/.config/apes/sp-tokens/tribe.openape.ai.json)
AGENT_JWT=$(jq -r .agent_jwt ~/.openape/agent/agent-jwt.json)
curl -H "Authorization: Bearer $USER_JWT"  http://localhost:3001/api/agents
curl -H "Authorization: Bearer $AGENT_JWT" http://localhost:3001/api/agents/me/tasks

# Reconcile from the agent host
apes agents sync --tribe-url http://localhost:3001  # (env-var alternative: OPENAPE_TRIBE_URL)
ls ~/Library/LaunchAgents/openape.tribe.*.plist

# Inspect a run
curl -H "Authorization: Bearer $USER_JWT" \
  http://localhost:3001/api/agents/alice/runs | jq '.[0]'
```
