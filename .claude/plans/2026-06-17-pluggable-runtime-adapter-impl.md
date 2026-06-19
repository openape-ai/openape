# Pluggable Runtime Adapter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** The nest can run an openclaw agent under our DDISA identity, talking to llms.openape.ai, acting via our CLIs — and our own bridge is just one adapter behind a shared contract.

**Architecture:** A `RuntimeAdapter` interface (`prepare` + `launchSpec`) in the nest; a registry keyed by the agent's new `runtime_type` (default `bridge`). `pm2-supervisor` derives the process from the adapter instead of hardcoding `bridge.mjs`.

**Tech Stack:** TS (Node ≥22), pnpm/turbo, nest (`apps/openape-nest`), troop schema (Drizzle), `packages/apes` + `packages/ape-troop` CLIs, openclaw CLI.

**Design spec:** `.claude/plans/2026-06-17-pluggable-runtime-adapter-design.md` · plans.openape.ai `01KVAR3GCX9H2692GVQVH1G7C8`.

## Progress (2026-06-17) — CODE COMPLETE, gates green, local E2E proven
- ✅ **Task 1 (spike)** — `openclaw-spike-findings.md`. one-shot embedded, no daemon.
- 🔀 **Task 2 (bridge→adapter refactor) deferred** — YAGNI (openclaw never touches pm2-supervisor); cleanup once a 2nd daemon runtime exists.
- ✅ **Task 3 (runtime_type wiring):** `AgentEntry.runtimeType` (apes + nest); `apes agents spawn --type` + validation; `ape-troop agents spawn --type` + troop-api body; troop `spawn-intent` bodySchema + `spawn-dispatch` → nest `spawn-intent` frame `runtime_type` → `apes spawn --type`; `Pm2Supervisor.reconcile` skips non-bridge. (troop DB column = deferred display-only; not on the execution path.)
- ✅ **Task 4 (openclaw adapter):** `apps/openape-nest/src/lib/openclaw-adapter.ts` — `prepareOpenclawHome` (config via the REAL openclaw schema: provider.models = `{id,name,api}` objects; SOUL/AGENTS/IDENTITY) + `invokeOpenclaw` (`openclaw agent --local --json --session-key …`) + `parseReply` (`{payloads:[{text}]}`). Wired into `resolveAgentRuntimeContext` (openclaw branch: dispatchTurn execs adapter, posts reply). `index.ts` dual-supervisor: SessionHost hosts openclaw agents alongside the pm2 bridge fleet.
- ✅ **Task 5 (E2E, local mechanism):** openclaw `2026.6.8`, configured by the adapter code, reached a local OpenAI-compatible echo via provider `openape`/`gpt-5.5`, honored `--session-key`, returned the reply; `invokeOpenclaw`→`parseReply` extracted clean text.
- ✅ **Test hardening (gaps 1–4):** `invokeOpenclaw` via injected `runAs`; `runOpenclawTurn` (invoke→post, extracted seam in `agent-runtime-session.ts`); `runtime-routing.ts` (`isDaemonRuntime`/`sessionHostAgents`, wired into pm2-supervisor + index.ts) + tests; `isRuntimeType` guard (apes, single source of allowed runtimes) + test. **26/26 tasks green** — apes 585, ape-troop 5, nest 106, troop 188.
- ⚠️ **Only-live (cannot test without a real model/nest):** tool-calling (CLI-as-tool), multi-turn continuity, gateway-with-real-DDISA-token, on-nest spawn — all fall to the deferred live E2E.

### Remaining (outward / deferred — needs explicit go)
- ✅ **DDISA-per-agent token to the gateway DONE (PR #808, 2026-06-19).** The MVP shared-LITELLM-key approach broke once the gateway went DDISA-only (master key → 401) + M4 (default path = LocalCore, gpt-5.x → 400). `resolveOpenclawGatewayKey` now mints the agent's own DDISA token per turn (`ensureFreshIdpAuth(home)` + `exchangeForSpToken`, home-scoped) and rewrites the openclaw config per one-shot turn; `GATEWAY_MODELS` → `LocalCore-*`.
- ✅ **Live E2E on a real nest DONE (2026-06-19).** Blue-green nest rebuild (`IMAGE=openape-nest:openclaw compose/nest-prod.run.sh`, 16 bridges reconnected, `-prev` kept). Spawned `openclaw-test --type openclaw` (own DDISA identity) → `session-host: now hosting 1 agent`. Proof: the agent'"'"'s **zero-grant** DDISA token → default `/v1` → 200 `LocalCore-Instant` (`'"'"'Hello there, how are you?'"'"'`) = M4 ungating; full `openclaw agent --local` turn → gateway (DDISA, LocalCore-Thinking) → reply `OPENCLAW-RUNTIME-OK`. Gotcha hit: the nest enroll-auth was stale → key-based reauth (`apes login --key`, config.toml identity) — see [[reference_nest_auth_reauth]].
- ✅ **CLI-tool-call under the DDISA identity DONE (2026-06-19) — works out of the box, no code change.** openclaw'"'"'s `exec` tool runs the agent'"'"'s `apes`/`ape-tasks`/`ape-troop` CLIs with `HOME=agent-home`, so they auth as the agent. Proven live on `openclaw-test`: read (`ape-tasks list` → the agent'"'"'s real list) and **write** (`ape-tasks new` created task `01KVFD3E…` under the agent'"'"'s identity, verified in its task list). `toolSummary: { calls: 1, tools: ['exec'], failures: 0 }`. The `apes run --as` escapes-grant gate was a red herring — that'"'"'s a different path; the chat exec runs the CLIs directly.
- ✅ **Nest image blessed as `:latest` DONE (2026-06-19)** — `:latest` = the fixed image (#808 + #810 typing); survives a recreate. `-prev` is the rollback.
- **Still deferred:** `sudo -u <agent>` tool-drop (currently openclaw runs the CLIs as root with `HOME=agent-home`; shared isolation work with the bridge); Task 2 bridge→adapter refactor (cleanup).

---

## Task 1: openclaw spike (resolve the unknowns — no monorepo code yet)

**Why first:** every later task bakes in openclaw's real run model + config path. Guessing = a wrong adapter. This task produces a short findings note, nothing more.

- [ ] **Step 1:** Install openclaw locally, pin the version. Record exact version.
  Run: `npm i -g openclaw@<latest>` (or per docs); `openclaw --version`.
- [ ] **Step 2:** Find the **per-instance config override**. We run N agents on one machine, each with its own config + workspace under its home. Determine how to point openclaw at a non-default config dir.
  Check: `openclaw --help`, `openclaw agent --help`, env vars (`OPENCLAW_HOME`/`OPENCLAW_CONFIG`?), or a `--config`/`--cwd` flag. Confirm `HOME=<agent-home>` alone redirects `~/.openclaw/` (the cheapest path — matches how we already isolate pm2 via `HOME`).
- [ ] **Step 3:** Determine **daemon vs one-shot**. Does a long-lived listening mode exist (`openclaw gateway`/`serve`) or is `openclaw agent --message` the only entry? This decides whether `launchSpec` is a long-running process or the nest execs per message.
- [ ] **Step 4:** Configure an OpenAI-compatible provider pointing at a dummy/base URL; run one `openclaw agent --agent X --message hi --local --json` and confirm via a local capture that **every** model call (incl. any tool-result turn) carries the provider `Authorization` bearer. (Point at a throwaway local listener that echoes headers.)
- [ ] **Step 5:** Write findings to `.claude/plans/openclaw-spike-findings.md`: version, config-override mechanism, run model (daemon/one-shot + exact command), header behavior. Update the design spec's "Open verification" section.

**Gate:** do not start Task 3 (openclaw-adapter) until Step 5 is written.

---

## Task 2: `RuntimeAdapter` contract + registry + bridge-adapter refactor

**Files:**
- Create: `apps/openape-nest/src/lib/adapters/types.ts`
- Create: `apps/openape-nest/src/lib/adapters/bridge-adapter.ts`
- Create: `apps/openape-nest/src/lib/adapters/index.ts`
- Create: `apps/openape-nest/src/lib/adapters/bridge-adapter.test.ts`
- Modify: `apps/openape-nest/src/lib/pm2-supervisor.ts`

- [ ] **Step 1: Write the contract types.** In `types.ts`: `RuntimeAdapter` is a **discriminated union** (Task 1 finding — openclaw is one-shot, not a daemon):
  - `{ kind:'daemon'; id; prepare(ctx); launchSpec(ctx):LaunchSpec }` — long-lived pm2 process (bridge).
  - `{ kind:'oneshot'; id; prepare(ctx); invoke(ctx,{message,sessionKey}):Promise<{text:string}> }` — exec per message (openclaw).
  `LaunchSpec` (`script`, `interpreter?`, `args?`, `env`, `cwd`), `AgentContext` (`home,email,name,nest,owner,recipe,model,reasoning?,gatewayBaseUrl,tokenRef`). The nest's chat router selects path by `kind`; only `daemon` adapters touch `pm2-supervisor`.

- [ ] **Step 2: Build `AgentContext` from `AgentEntry`.** In `index.ts`, `contextFor(agent): AgentContext` reusing the same fields `ecosystemEnvLines(agent)` reads today. `gatewayBaseUrl` from existing config; `tokenRef` = `{kind:'env', value:'OPENAI_API_KEY'}` placeholder for bridge (unused by bridge).

- [ ] **Step 3: Failing test for bridge-adapter parity.** `bridge-adapter.test.ts`: given a sample `AgentEntry`, `BridgeAdapter.launchSpec(ctx).script` === the current bridge entrypoint and `.env` includes the same keys `ecosystemEnvLines` produced. Run: `pnpm turbo run test --filter=@openape/nest` → FAIL (no BridgeAdapter yet).

- [ ] **Step 4: Implement `BridgeAdapter`.** Move today's logic: `prepare` = `resolveBridgeConfig`-driven config write (whatever `ensureAgent`/materialize does today); `launchSpec` returns the script/env/cwd `ecosystemContents` currently bakes. Registry `adapters = { bridge: new BridgeAdapter() }`, `adapterFor(agent) = adapters[agent.runtime_type ?? 'bridge']`.

- [ ] **Step 5: Rewire `pm2-supervisor`.** `ecosystemContents(agent)` now: `const a = adapterFor(agent); await a.prepare(ctx); const spec = a.launchSpec(ctx)` → emit ecosystem with `script: spec.script`, `interpreter`, `args`, `cwd`, env from `spec.env`. Keep the file-write/setgid/start.sh machinery unchanged.

- [ ] **Step 6: Test green + byte-parity check.** Run test (PASS). Then diff a generated `ecosystem.config.js` for a sample bridge agent before/after the refactor — must be byte-identical (default fleet untouched). Record the diff (empty) in the commit message.

- [ ] **Step 7: Commit.** `feat(nest): runtime-adapter contract + bridge as reference adapter`.

---

## Task 3: `runtime_type` field through schema + CLI

**Files:**
- Modify: troop schema (Drizzle) — agents table `runtime_type text` nullable.
- Modify: nest agent store / `AgentEntry` type — carry `runtime_type`.
- Modify: `packages/ape-troop/src/commands/agents.ts` (+ `packages/apes` agents if it mirrors) — `spawn --type <id>`.
- Modify: TroopSync / agents.json materialization to include `runtime_type`.

- [ ] **Step 1: Schema migration.** Add nullable `runtime_type` to the troop agents table; generate the Drizzle migration. Default semantics = `null` ⇒ `bridge`.
- [ ] **Step 2: Thread the field.** `AgentEntry` + nest store + `agents.json` materialization include `runtime_type`; TroopSync carries it from troop → nest.
- [ ] **Step 3: CLI flag.** `apes agents spawn --type <id>` (default `bridge`) persists `runtime_type` on create. Validate against the adapter registry keys (reject unknown types with a clear error). `apes agents list` shows the type column.
- [ ] **Step 4: Test.** Unit: spawn with `--type openclaw` persists `runtime_type:"openclaw"`; spawn without `--type` persists null/`bridge`; unknown type errors. Run filtered tests → PASS.
- [ ] **Step 5: Commit.** `feat(troop,apes): agent runtime_type field + spawn --type`.

---

## Task 4: openclaw-adapter (uses Task 1 findings)

**Files:**
- Create: `apps/openape-nest/src/lib/adapters/openclaw-adapter.ts`
- Create: `apps/openape-nest/src/lib/adapters/openclaw-adapter.test.ts`
- Modify: `apps/openape-nest/src/lib/adapters/index.ts` (register `openclaw`)

`kind:'oneshot'` (Task 1: no daemon). openclaw `2026.6.8`.

- [ ] **Step 1: Failing test for config generation.** Given a sample `AgentContext` (recipe with persona + model `gpt-5.5`), `OpenclawAdapter.prepare(ctx)` produces the openclaw config (provider `openape` `baseUrl:gatewayBaseUrl`, default agent `model:"openape/gpt-5.5"`, `reasoningDefault:"off"`, exec/shell tool allowed) and workspace files `SOUL.md` / `AGENTS.md` (contains agent email + "your tools are apes/ape-tasks/ape-troop") / `IDENTITY.md` under `ctx.home`. Assert via reading the written config back with `openclaw config get` and reading the workspace files. Run → FAIL.
- [ ] **Step 2: Implement `prepare`.** Write config via `openclaw config patch --stdin` with env `OPENCLAW_CONFIG_PATH=<home>/openclaw.json OPENCLAW_STATE_DIR=<home>/.openclaw-state` (schema-validated). Write `workspace/{SOUL,AGENTS,IDENTITY}.md` from `ctx.recipe`. Idempotent.
- [ ] **Step 3: Implement `invoke(ctx,{message,sessionKey})`.** Exec `openclaw agent --local --json --message <message> --session-key agent:<name>:<sessionKey> [--model openape/<model>]` with env `{ HOME:ctx.home, OPENCLAW_CONFIG_PATH, OPENCLAW_STATE_DIR, OPENAI_API_KEY:<fresh token> }`; parse `--json` stdout → `{text}`. No pm2/`launchSpec`.
- [ ] **Step 4: Token wiring + chat-router hook.** Read the agent's gateway token from `ctx.home/.config/apes/auth.json` (sp-token cache) **at each `invoke`** (one-shot ⇒ near-fresh, softens sharp edge #1). Hook the nest chat router (`session-host`/`troop-ws`) so an incoming message for a `kind:'oneshot'` agent calls `adapter.invoke` and returns the reply, instead of delivering to a daemon socket.
- [ ] **Step 5: Register + test green.** Add `openclaw` to the registry. Run filtered tests → PASS.
- [ ] **Step 6: Commit.** `feat(nest): openclaw runtime adapter`.

---

## Task 5: MVP E2E proof

- [ ] **Step 1:** On a test nest (or local stack), ensure openclaw installed + the agent's `auth.json` present with an llms.openape.ai grant.
- [ ] **Step 2:** `apes agents spawn --type openclaw --name test-ceo --model gpt-5.5 --recipe <ceo>`. Confirm the process is up (`pm2 ls` in the agent home) OR the per-message runner is registered.
- [ ] **Step 3:** Send a prompt to the agent. Capture the llms.openape.ai access log line: `200` for `gpt-5.5` carrying this agent's DDISA token (not master_key).
- [ ] **Step 4:** Have it run `ape-tasks new …` as a tool; confirm the task lands under the agent identity (correct `owner`/`assignee`).
- [ ] **Step 5:** Confirm a default `--type bridge` agent is unchanged (spot-check one live bridge agent still runs).
- [ ] **Step 6:** Record evidence (gateway log + created task) — optionally a testrun.openape.ai report for a shareable proof link. Update the design spec status → done; mark plan `done`.

---

## Self-review notes
- Task 1 gates Task 4 (no guessed openclaw internals in code).
- Task 2 enforces byte-parity for the default fleet (the risk: refactor changes live bridge behavior).
- `runtime_type` default `bridge` everywhere ⇒ zero impact on existing 18 agents until someone opts in.
- Out of scope (per spec): cron/DM/channels for openclaw, MCP server, remote nests.
