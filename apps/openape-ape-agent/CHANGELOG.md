# @openape/ape-agent

## 2.1.0

### Minor Changes

- [#399](https://github.com/openape-ai/openape/pull/399) [`b1181aa`](https://github.com/openape-ai/openape/commit/b1181aa86909b8f9288bcdcd92ffa0ea024af4c7) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Agent skills (SKILL.md) + SOUL.md, modeled on OpenClaw's lazy-load skill pattern.

  **`@openape/ape-agent`** gains a system-prompt composer that scans `~/.openape/agent/skills/*/SKILL.md` + `~/.openape/agent/SOUL.md` on every new chat thread and injects an `<available_skills>` block into the LLM system prompt. The LLM loads each skill's body lazily via the `file.read` tool when the task description matches — keeps the cold-start prompt small even as the skill catalog grows. SOUL.md is always-on (no lazy load) — persona, language preferences, hard rules.

  Default skills for the six built-in tool families (`time`, `http`, `file`, `tasks`, `mail`, `bash`) ship bundled with the package under `default-skills/`. They get merged with agent-side skills (same-name agent skill wins) and filtered against the agent's enabled tools — a skill whose `requires_tools` aren't enabled is dropped from the prompt.

  **`@openape/apes`** — `apes agents sync` now writes:

  - `~/.openape/agent/SOUL.md` (from troop's `soul` column)
  - `~/.openape/agent/skills/<name>/SKILL.md` for each enabled row in troop's `agent_skills` table

  The sync is a one-way mirror: rows deleted/disabled in troop get pruned from disk on the next sync. Existing agents pick up the feature on first sync after the deploy; their SOUL is empty and their skills list is empty until the owner adds some in the troop UI.

  **Troop** (separate app, not versioned here) adds:

  - `agents.soul TEXT NOT NULL DEFAULT ''`
  - new `agent_skills` table: `(agent_email, name)` primary key, `description`, `body`, `enabled`
  - `PATCH /api/agents/:name` accepts `soul: string`
  - `GET /api/agents/:name/skills`, `PUT /api/agents/:name/skills`, `DELETE /api/agents/:name/skills/:skillName`
  - Agent detail page: SOUL.md textarea + Skills CRUD (modal editor)

### Patch Changes

- Updated dependencies [[`b1181aa`](https://github.com/openape-ai/openape/commit/b1181aa86909b8f9288bcdcd92ffa0ea024af4c7)]:
  - @openape/apes@1.22.0

## 2.0.2

### Patch Changes

- Updated dependencies [[`4293cdf`](https://github.com/openape-ai/openape/commit/4293cdf8ed89d3fea89d80bb48c1b8df1e473e3a)]:
  - @openape/apes@1.21.0

## 2.0.1

### Patch Changes

- Updated dependencies [[`9a207dd`](https://github.com/openape-ai/openape/commit/9a207dd5e3853f7304aa80a96c64016854b1f8d7)]:
  - @openape/apes@1.20.0

## 2.0.0

### Major Changes

- [#393](https://github.com/openape-ai/openape/pull/393) [`763e699`](https://github.com/openape-ai/openape/commit/763e69914330a80832293f155c36e23c5e75ead0) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Rename `@openape/chat-bridge` to `@openape/ape-agent`.

  The old name was an implementation leak — "chat-bridge" suggested a dumb
  forwarding pipe, but the package hosts the entire agent runtime (LLM
  loop, tools, per-thread memory, cron tasks). The new name lines up with
  the rest of the CLI surface (`apes`, `ape-tasks`, `ape-agent`).

  **Migration:**

  - `npm i -g @openape/ape-agent@latest` — installs both the new
    canonical binary `ape-agent` and the legacy `openape-chat-bridge`
    alias (same script).
  - Existing pm2 ecosystem files that invoke `openape-chat-bridge` keep
    working as long as `@openape/ape-agent` is installed globally.
  - New spawns invoke `ape-agent` directly (`apes captureHostBinDirs`
    resolves the new name; the YOLO policy in `apes nest authorize`
    allows both binaries).

  `@openape/chat-bridge` on npm is deprecated and will receive no further
  updates. Run `npm deprecate @openape/chat-bridge "Renamed to @openape/ape-agent"`
  after this changeset lands.

### Patch Changes

- Updated dependencies [[`763e699`](https://github.com/openape-ai/openape/commit/763e69914330a80832293f155c36e23c5e75ead0)]:
  - @openape/apes@1.19.0

## 1.4.0

### Minor Changes

- [#390](https://github.com/openape-ai/openape/pull/390) [`35d19af`](https://github.com/openape-ai/openape/commit/35d19af86afc4236c2b9afdfd0b8b65e385b70b4) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Per-agent tool whitelist — owner-controlled via troop, default all-tools-enabled on first sync.

  **What changed**:

  - `openape-troop`: `agents` table gains a `tools text` column (JSON string array, defaults to `'[]'` for legacy rows). New agents on first sync get the full `tool-catalog.json` list as their default — owner narrows via `PATCH /api/agents/<name>` (the existing endpoint now also accepts `tools: string[]`).
  - `GET /api/agents/me/tasks` returns the agent's `tools[]` alongside `system_prompt` and `tasks`.
  - `apes agents sync` writes the resolved tool list into `~/.openape/agent/agent.json` (alongside `systemPrompt`).
  - `@openape/chat-bridge` reads `tools[]` from `agent.json` on every new chat thread, replacing the legacy `APE_CHAT_BRIDGE_TOOLS` env var as the source of truth. The env var stays as a fallback when `agent.json` doesn't have a `tools` field (e.g. before the next sync).

  **Net effect**: tools are now per-agent + owner-editable. Defaults to all 9 shipped tools (`time.now`, `http.get`, `http.post`, `file.read`, `file.write`, `tasks.list`, `tasks.create`, `mail.list`, `mail.search`) so new agents are immediately useful in chat. Owner narrows when needed.

  Existing agents (`tools=[]` from migration) get nothing in chat until they sync — recommended one-time fix: `PATCH /api/agents/<name>` with `tools: [<full list>]` per agent, or just `apes agents sync` once and the agent re-registers (which doesn't run the default-all path because the row already exists). For Patrick's local fleet, simplest is a single SQL update on the troop DB to set `tools='[…]'` on existing rows.

### Patch Changes

- Updated dependencies [[`35d19af`](https://github.com/openape-ai/openape/commit/35d19af86afc4236c2b9afdfd0b8b65e385b70b4)]:
  - @openape/apes@1.18.0

## 1.3.8

### Patch Changes

- Updated dependencies [[`49811c2`](https://github.com/openape-ai/openape/commit/49811c2a103c2d313d84e48abf327847ed9c8098)]:
  - @openape/apes@1.17.0

## 1.3.7

### Patch Changes

- Updated dependencies [[`713305a`](https://github.com/openape-ai/openape/commit/713305a363384a01e05d241738f4fae5d0fdc9a2)]:
  - @openape/apes@1.16.0

## 1.3.6

### Patch Changes

- Updated dependencies [[`76a2a71`](https://github.com/openape-ai/openape/commit/76a2a71dbe0449a018f3a04fae39322a19c04526)]:
  - @openape/apes@1.15.0

## 1.3.5

### Patch Changes

- Updated dependencies [[`8803401`](https://github.com/openape-ai/openape/commit/880340194b1c16d0ee9cd42d154ff16ee1951864)]:
  - @openape/apes@1.14.0

## 1.3.4

### Patch Changes

- Updated dependencies [[`56e5c66`](https://github.com/openape-ai/openape/commit/56e5c66ab00f8d579def86be1ae23d28214aa3a7)]:
  - @openape/apes@1.13.1

## 1.3.3

### Patch Changes

- Updated dependencies [[`ce9bef7`](https://github.com/openape-ai/openape/commit/ce9bef7487849f3c74fa9a8f7753e0465484e9a5)]:
  - @openape/apes@1.13.0

## 1.3.2

### Patch Changes

- [#382](https://github.com/openape-ai/openape/pull/382) [`0e06c51`](https://github.com/openape-ai/openape/commit/0e06c516dbfd3d5969f0bcf39ffbab4fa179f868) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Bridge loads its `.env` file at startup. Phase D removed the `start.sh` wrapper that used to `source` this file before exec'ing the bridge; the Nest supervisor invokes the bridge directly. Without start.sh nobody loaded `~/Library/Application Support/openape/bridge/.env`, so `APE_CHAT_BRIDGE_MODEL` was never set and the bridge bailed at boot with the new fail-fast (#375). Bridge now reads + merges the file itself before checking required vars; explicit env still wins over the file (no overwrite of `process.env[key]` if already set).

## 1.3.1

### Patch Changes

- Updated dependencies [[`157742d`](https://github.com/openape-ai/openape/commit/157742d8311298eab2a750836aac036bdbe2ae5a), [`3e56e49`](https://github.com/openape-ai/openape/commit/3e56e49fb3bf262059d702a539be0fc4862b4e6a), [`aedcb6b`](https://github.com/openape-ai/openape/commit/aedcb6bd2cbd3cb72287bbc03c1040bca3cc9d16)]:
  - @openape/apes@1.12.0

## 1.3.0

### Minor Changes

- [#378](https://github.com/openape-ai/openape/pull/378) [`5e69208`](https://github.com/openape-ai/openape/commit/5e69208ce524c40f0e19282b282d7e003f2e052f) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase A of the architecture simplification (#sim-arch): merge the chat-bridge daemon and the per-turn agent runtime into a single in-process loop.

  The bridge previously spawned `apes agents serve --rpc` as a long-lived stdio JSON-RPC subprocess and dispatched each turn through it. Now it imports `runLoop` from `@openape/apes` directly. Same loop, no IPC overhead, no second process to keep alive. Per-thread message history that used to live in the subprocess's `RpcSessionMap` now lives on each `ThreadSession` itself.

  `@openape/apes` exposes the runtime surface for in-process use:

  - `runLoop`, `RpcSessionMap` (classes/functions)
  - `ChatMessage`, `RunOptions`, `RunResult`, `RuntimeConfig`, `RunStreamHandlers`, `TraceEntry`, `ToolDefinition` (types)
  - `taskTools`, `TOOLS` (helpers)

  The `apes agents serve --rpc` command is preserved for backwards compatibility with bridge versions <1.3 that still spawn it via stdio.

  Net effect: one process per agent (the bridge), instead of two (bridge + serve). Faster turns (no IPC marshaling), simpler crash semantics, cron tasks share the same in-process runtime.

### Patch Changes

- Updated dependencies [[`5e69208`](https://github.com/openape-ai/openape/commit/5e69208ce524c40f0e19282b282d7e003f2e052f)]:
  - @openape/apes@1.11.0

## 1.2.0

### Minor Changes

- [`a9c1eb5`](https://github.com/openape-ai/openape/commit/a9c1eb578fcc558ed9213f71e05779c03e1b829a) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - The chat-bridge no longer falls back to `claude-haiku-4-5` when `APE_CHAT_BRIDGE_MODEL` is unset — it now throws at startup with a pointer to the env file the user should set. The previous default silently misrouted on LiteLLM proxies fronting only ChatGPT (or only Anthropic), producing a `400 Invalid model name` response on every chat-completion request that was visible to the human only as a runtime error in the chat UI long after spawn. Failing fast at boot with a clear message is the correct user experience.

  `apes [nest|agents] spawn --bridge` already writes the model into `~/Library/Application Support/openape/bridge/.env` based on `~/litellm/.env` (or `--bridge-model`), so this only affects setups where someone hand-launched the bridge without configuring it.

## 1.1.3

### Patch Changes

- Updated dependencies [[`8ca96f1`](https://github.com/openape-ai/openape/commit/8ca96f10f7a0a9c8adc5afa5c8fd863f62342f6c)]:
  - @openape/cli-auth@0.4.0

## 1.1.2

### Patch Changes

- [#351](https://github.com/openape-ai/openape/pull/351) [`63b2f70`](https://github.com/openape-ai/openape/commit/63b2f706bb184a5f691f087ccd53384b6547b403) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - CronRunner now reports run history to troop. Each fire opens a `running` row via `POST /api/agents/me/runs`, and the `done`/`error` event PATCHes it with status + final_message + step_count. Closes the gap left by moving cron in-process from per-task launchd plists (#348) — without this, the troop owner UI's "Recent runs" stayed empty after every fire.

## 1.1.1

### Patch Changes

- [#350](https://github.com/openape-ai/openape/pull/350) [`07a8346`](https://github.com/openape-ai/openape/commit/07a834625f076d0d1faa8e6c551c38e4f81fa95d) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix two issues that surfaced on first cron-task DM:

  1. **Tool names rejected by ChatGPT API**: catalog tool names like `time.now` failed the Responses API's `^[a-zA-Z0-9_-]+$` pattern via LiteLLM. Wire-encode dots to underscores when sending tools to the LLM (`time.now` → `time_now`); decode the model's tool_call back to the local catalog name.

  2. **Task DMs landing in main thread instead of dedicated thread**: cron-runner now explicitly POSTs `/api/rooms/<id>/threads` with the task's name on first run, then reuses the returned threadId for every subsequent run of that task.

## 1.1.0

### Minor Changes

- [#348](https://github.com/openape-ai/openape/pull/348) [`8fa08c4`](https://github.com/openape-ai/openape/commit/8fa08c4c9a76b328efd66325e43b5da5b99dd22a) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Cron tasks now run **inside the chat-bridge daemon** instead of via per-task launchd plists. One process, one LiteLLM config (the bridge's), one WebSocket to chat.openape.ai. The bridge's existing `ApesRpcSession` is reused for task fires — fixed `session_id = task:<taskId>` so the runtime carries memory across runs (within its evict TTL), fixed chat thread per task (persisted to `~/.openape/agent/task-threads.json`) so all runs of one task land in the same chat thread instead of fanning out into N independent DMs.

  `apes agents sync` no longer reconciles per-task launchd plists. The chat-bridge's `CronRunner` ticks every 60s, reads `~/.openape/agent/tasks/*.json`, fires anything whose cron matches the current minute. `apes agents run` is now optional (kept for ad-hoc invocation but no longer scheduled by the bridge stack).

## 1.0.0

### Major Changes

- [#332](https://github.com/openape-ai/openape/pull/332) [`a77db3a`](https://github.com/openape-ai/openape/commit/a77db3a4be9cc3e37af574578a70fb5095c73cc5) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - **BREAKING**: chat-bridge now spawns `apes agents serve --rpc` instead of `pi --mode rpc`. Drops the `@mariozechner/pi-coding-agent` runtime dependency entirely — the bridge runs against `@openape/apes` (≥ 0.32.0) which embeds a LiteLLM-backed runtime with the OpenApe tool catalog.

  Env vars changed:

  - removed: `APE_CHAT_BRIDGE_PI_BIN`, `APE_CHAT_BRIDGE_PROVIDER`
  - renamed: `APE_CHAT_BRIDGE_MODEL` (default now `claude-haiku-4-5` instead of `gpt-5.4`)
  - new: `APE_CHAT_BRIDGE_APES_BIN` (default: `apes` on `$PATH`), `APE_CHAT_BRIDGE_TOOLS` (comma-separated, default empty), `APE_CHAT_BRIDGE_MAX_STEPS` (default 10), `APE_CHAT_BRIDGE_SYSTEM_PROMPT` (default: friendly assistant)

  Migration on existing agent hosts: re-run `apes agents spawn --bridge <name>` so the launchd plist + start.sh pick up the new env defaults.

## 0.3.2

### Patch Changes

- Updated dependencies [[`6539c9b`](https://github.com/openape-ai/openape/commit/6539c9b290b9d9f062f54dfdf5378957ee668018)]:
  - @openape/cli-auth@0.3.0

## 0.3.1

### Patch Changes

- [`b519e3f`](https://github.com/openape-ai/openape/commit/b519e3f858011358056daaec8f54a2694c59f191) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix bridge crash-loop "auth.json missing 'owner_email'" after `apes login`.

  - `@openape/cli-auth`: `saveIdpAuth` now merges with existing fields instead of overwriting wholesale. `apes login` (called from the bridge's `start.sh` on every daemon boot) used to silently drop `owner_email` written by `apes agents spawn`, leaving the bridge in a fatal restart loop until the auth.json was manually re-stamped. The merge preserves any unknown keys in the file across logins.
  - `@openape/chat-bridge`: `readAgentIdentity` falls back to `OPENAPE_OWNER_EMAIL` env var when `owner_email` is missing from auth.json, so an old agent (spawned before the Phase A migration) can be unblocked by adding one line to its launchd plist.

- Updated dependencies [[`b519e3f`](https://github.com/openape-ai/openape/commit/b519e3f858011358056daaec8f54a2694c59f191)]:
  - @openape/cli-auth@0.2.4

## 0.3.0

### Minor Changes

- [#256](https://github.com/openape-ai/openape/pull/256) [`e77ba19`](https://github.com/openape-ai/openape/commit/e77ba19f595ec72f628f0b274b02a5a307269b77) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase B: multiple parallel threads per chat room (ChatGPT-style sessions per contact).

  - Server: new `threads` table + `messages.thread_id` column. New endpoints `GET/POST /api/rooms/:id/threads`, `PATCH/DELETE /api/threads/:id`. `messages.get` accepts `thread_id` filter; `messages.post` accepts `thread_id` and falls back to a lazily-created `main` thread for back-compat with existing rooms. Contacts auto-create the main thread on DM creation.
  - Bridge: pi-RPC sessions are now keyed by `(roomId, threadId)` so parallel conversations with the same human stay in independent contexts. Inbound messages without `threadId` are dropped (server guarantees the field).
  - CLI: new `ape-chat threads {list|new|use|rename|archive}` command, plus `--thread` flags on `send` and `list`. Active thread is remembered per-room in `~/.openape/auth-chat.json`.
  - Webapp: thread switcher tabs in the room view (mobile-first horizontal scroll), `+` to create a thread inline, messages and outgoing posts scoped to the active thread.

## 0.2.2

### Patch Changes

- [#253](https://github.com/openape-ai/openape/pull/253) [`1b05c4b`](https://github.com/openape-ai/openape/commit/1b05c4b0c3b9cb61e353979d1b66e3b4670cf22d) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase A frontend + CLI:

  - chat.openape.ai webapp shows contacts (incoming pending, connected, outgoing pending) with accept/decline/cancel actions and an "Add contact" dialog. Mobile-first. Live-updates via WS membership-\* frames.
  - `@openape/ape-chat`: new `contacts list / add / accept / remove` subcommand.
  - `@openape/apes`: new `apes agents allow <agent> <peer-email>` — adds peer to the agent's bridge-allowlist file so the bridge auto-accepts that peer's contact request.
  - chat-bridge polls the allowlist + pending contacts every 30s while connected, so an `apes agents allow` change takes effect within half a minute without a daemon restart.

## 0.2.1

### Patch Changes

- [#251](https://github.com/openape-ai/openape/pull/251) [`c314e7a`](https://github.com/openape-ai/openape/commit/c314e7a3f6594e097166024ac6465bbb2c181a80) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase A backend — chat-app gains a `contacts` table + friend-request lifecycle. `apes agents spawn --bridge` now POSTs `/api/contacts` instead of creating a DM room directly; the bridge daemon accepts pending requests on first connect, completing the bilateral handshake without manual intervention. Direct `POST /api/rooms { kind: 'dm' }` is now rejected — DMs are owned by the contacts model and lazy-created on bilateral accept.

## 0.2.0

### Minor Changes

- [`3c0d06c`](https://github.com/openape-ai/openape/commit/3c0d06c35e3974de009a19f7041e88e1e77421ae) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - `@openape/chat-bridge` rewritten to drive pi via its RPC mode (`pi --mode rpc`) instead of one-shot `pi --print` per message. One long-lived pi subprocess per chat room means the conversation now has memory across messages — "what's 7×6?" then "and ×2?" produces "84" not a confused "what do you mean ×2?". The agent's reply also visibly grows in real time as pi streams `text_delta` events: bridge posts a placeholder message and PATCHes it progressively (throttled ~300ms).

  `@openape/apes`: bridge `start.sh` now always pulls `@openape/chat-bridge@latest` on boot, so restarting the launchd daemon picks up new bridge versions without manual intervention. Pi extension setup unchanged.

## 0.1.0

### Minor Changes

- [#229](https://github.com/openape-ai/openape/pull/229) [`2177da5`](https://github.com/openape-ai/openape/commit/2177da505f4c0b241e3d9bfdf2253695d7c3c81a) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Initial release of `@openape/ape-chat` (CLI for chat.openape.ai) and `@openape/chat-bridge` (daemon that lets a local LLM CLI like pi answer chat messages on behalf of an apes-spawned agent). See each package's README for setup and usage.
