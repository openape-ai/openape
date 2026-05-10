# @openape/apes

## 1.18.0

### Minor Changes

- [#390](https://github.com/openape-ai/openape/pull/390) [`35d19af`](https://github.com/openape-ai/openape/commit/35d19af86afc4236c2b9afdfd0b8b65e385b70b4) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Per-agent tool whitelist — owner-controlled via troop, default all-tools-enabled on first sync.

  **What changed**:

  - `openape-troop`: `agents` table gains a `tools text` column (JSON string array, defaults to `'[]'` for legacy rows). New agents on first sync get the full `tool-catalog.json` list as their default — owner narrows via `PATCH /api/agents/<name>` (the existing endpoint now also accepts `tools: string[]`).
  - `GET /api/agents/me/tasks` returns the agent's `tools[]` alongside `system_prompt` and `tasks`.
  - `apes agents sync` writes the resolved tool list into `~/.openape/agent/agent.json` (alongside `systemPrompt`).
  - `@openape/chat-bridge` reads `tools[]` from `agent.json` on every new chat thread, replacing the legacy `APE_CHAT_BRIDGE_TOOLS` env var as the source of truth. The env var stays as a fallback when `agent.json` doesn't have a `tools` field (e.g. before the next sync).

  **Net effect**: tools are now per-agent + owner-editable. Defaults to all 9 shipped tools (`time.now`, `http.get`, `http.post`, `file.read`, `file.write`, `tasks.list`, `tasks.create`, `mail.list`, `mail.search`) so new agents are immediately useful in chat. Owner narrows when needed.

  Existing agents (`tools=[]` from migration) get nothing in chat until they sync — recommended one-time fix: `PATCH /api/agents/<name>` with `tools: [<full list>]` per agent, or just `apes agents sync` once and the agent re-registers (which doesn't run the default-all path because the row already exists). For Patrick's local fleet, simplest is a single SQL update on the troop DB to set `tools='[…]'` on existing rows.

## 1.17.0

### Minor Changes

- [#389](https://github.com/openape-ai/openape/pull/389) [`49811c2`](https://github.com/openape-ai/openape/commit/49811c2a103c2d313d84e48abf327847ed9c8098) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - `apes agents spawn` now skips the second redundant `apes run --as root` escalation when it's already running as root. Net effect: only ONE DDISA approval per new agent (the outer `apes run --as root -- apes agents spawn <name>` from the wrapper), down from two.

  The inner escalation existed for the case where `apes agents spawn` is invoked directly (not via `apes nest spawn`) — then it does need to ask for root privileges. But when called from `apes nest spawn` (which already wraps in `apes run --as root`), the second grant is pure redundancy. We detect via `process.getuid() === 0` and bash setup.sh inline in that case.

  Plus: `apes run` audience-mode now reuses approved `timed`/`always` grants matching the requested command exactly, instead of always creating a fresh pending grant. Same agent spawned twice → 0 approvals on the second call. New agent name → still needs one approval (per name).

## 1.16.0

### Minor Changes

- [#388](https://github.com/openape-ai/openape/pull/388) [`713305a`](https://github.com/openape-ai/openape/commit/713305a363384a01e05d241738f4fae5d0fdc9a2) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase G follow-up: `apes nest destroy <name>` (and `apes agents destroy`) is now fully scriptable for Phase G+ agents — no admin-password prompt, no TTY required.

  Detection: if the agent's `NFSHomeDirectory` (read from dscl) starts with `/var/openape/homes/`, the new `buildPhaseGTeardownScript` runs via `apes run --as root` and:

  - launchctl bootout + pkill
  - rm -rf /var/openape/homes/<name> (no FDA wall on /var/, root just does it)
  - rm -rf /var/openape/agents/<name> (per-agent ecosystem files)
  - skip sysadminctl entirely — the dscl record stays as a hidden tombstone (uid in service range, IsHidden=1, NFSHomeDirectory pointing nowhere). Operators can `sudo sysadminctl -deleteUser <name>` interactively for full cleanup; the tombstone is otherwise harmless.

  Legacy agents under `/Users/<name>/` still go through the old sudo + sysadminctl + admin-password path — `rm -rf /Users/...` hits FDA without a UI session.

  Plus: registry file mode bumped from 600 to 660 (group `_openape_nest`) so the human user can `apes nest list` without sudo. The file holds no secrets.

## 1.15.0

### Minor Changes

- [#387](https://github.com/openape-ai/openape/pull/387) [`76a2a71`](https://github.com/openape-ai/openape/commit/76a2a71dbe0449a018f3a04fae39322a19c04526) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase G of the architecture simplification (#sim-arch): new agent homes live under `/var/openape/homes/<name>/` instead of `/Users/<name>/`. Hidden service-account users belong with their kin (`_www` → `/var/empty`, `_postgres` → `/var/empty`, our own `_openape_nest` → `/var/openape/nest`). Keeping `/Users/` for real human accounts only — Finder, TimeMachine, Migration Assistant stop seeing the agents.

  The dscl record stays at `/Users/<name>` (that's the dscl namespace, not a filesystem path). Only `NFSHomeDirectory` changes: setup.sh's dscl create line uses the new path, and pre-creates `/var/openape/homes/` (mode 755, world-traversable so the per-agent dirs are reachable from each agent's uid).

  `MacOSUserSummary` gains a `homeDir` field parsed from `dscl . -read /Users/<name> NFSHomeDirectory`. Callers (`apes agents destroy`, `apes agents list`, the Nest's pm2-supervisor `start.sh`) resolve the home dynamically — Phase G+ agents at the new path, legacy agents still at `/Users/<name>`.

  **Existing agents are NOT migrated.** Moving an existing agent would require `rm -rf /Users/<name>` which hits macOS's FDA wall (FDA-blocked operation needing UI session permissions — same constraint that makes `apes agents destroy` partial today). Existing agents keep their `/Users/` homes; new spawns use the new path. Mixed inventory works because everything resolves the home from dscl at runtime.

## 1.14.0

### Minor Changes

- [`8803401`](https://github.com/openape-ai/openape/commit/880340194b1c16d0ee9cd42d154ff16ee1951864) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase F of the architecture simplification (#sim-arch): drop the intent-channel entirely. The Nest is now a pure observer with three responsibilities — pm2-supervisor, troop-sync, and registry-watcher (`fs.watch` on `agents.json`).

  **What changed**:

  - The apes-cli's `apes nest spawn|destroy|list` no longer drops files into `/var/openape/nest/intents/` and polls for responses. They directly shell out to `apes run --as root -- apes agents spawn|destroy <name>` (which already requires a DDISA root grant — Patrick approves once with `--approval always` on his identity, then silent reuse).
  - `apes agents spawn` and `apes agents destroy` write to the Nest's `agents.json` registry themselves before exiting (new `lib/nest-registry.ts` helper).
  - The Nest's `fs.watch` on `agents.json` triggers reconcile within ~1s of any change. pm2 starts the bridge for new entries; pm2-deletes the bridge for removed ones.

  **What was removed**:

  - `apps/openape-nest/src/lib/intent-channel.ts` (~200 LOC)
  - `apps/openape-nest/src/api/agents.ts`
  - `packages/apes/src/lib/nest-intent.ts`

  **Permissions note**: the registry file lives at `/var/openape/nest/agents.json` mode 660 group `_openape_nest`. Patrick (a member of that group post-`migrate-to-service-user`) can rw it directly. Pre-migration installs use `~/.openape/nest/agents.json` and don't need the group dance.

  **Net effect**: simpler architecture (~250 fewer LOC), more aligned with the "Nest is a long-running CLIENT" model — no inbound channel of any kind.

## 1.13.1

### Patch Changes

- [#385](https://github.com/openape-ai/openape/pull/385) [`56e5c66`](https://github.com/openape-ai/openape/commit/56e5c66ab00f8d579def86be1ae23d28214aa3a7) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix Phase E pm2-supervisor: three issues that conspired to make `pm2 startOrReload` silently fail when invoked from the Nest:

  1. **`bash -c '<inline cmd>'` arg-quoting** — escapes-helper passes the command-array to bash as separate argv; `bash -c` then treats only the first item as the script body and the rest as `$0`/`$1`/... so redirects + sub-args got dropped silently. Switched to a per-agent `start.sh` wrapper script (mode 755) committed at spawn time.

  2. **`process.cwd()` EACCES** — the Nest's cwd is `/var/openape/nest` (mode 750, \_openape_nest only). After escapes setuid to the agent uid, Node's startup `uv_cwd()` failed with EACCES because the agent can't read the inherited cwd. Set `cwd: '/tmp'` on the supervisor's spawn so the new uid lands in a world-readable dir.

  3. **pm2's exit code is non-zero in some success paths** — `pm2 startOrReload` exits with warnings/errors even when the operation succeeded. Added a `pm2 jlist` probe after start: if the expected app is `online`, log success regardless of the cli's exit code; otherwise log "NOT online" with a pointer to the per-agent pm2 log.

  Plus: log dir `/var/log/openape/` needs mode 1777 so per-agent pm2 instances (different uids) can each append their own log file there. The `apes nest install` flow could create this idempotently in a follow-up; for now operators run `mkdir -p /var/log/openape && chmod 1777 /var/log/openape` once after upgrading.

## 1.13.0

### Minor Changes

- [#383](https://github.com/openape-ai/openape/pull/383) [`ce9bef7`](https://github.com/openape-ai/openape/commit/ce9bef7487849f3c74fa9a8f7753e0465484e9a5) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase E of the architecture simplification (#sim-arch): bridge processes are now supervised by a **per-agent** pm2-god daemon running as the agent's own macOS uid.

  **Process tree per agent**:

  ```
  launchd → nest (uid 481 _openape_nest)
              └── shell-outs: `apes run --as agentx -- pm2 startOrReload <ecosystem>`
                    └── escapes (root, setuid switch)
                          └── pm2-god (uid agentx)  ← persistent across Nest restarts
                                └── openape-chat-bridge (uid agentx)  ← direct pm2 child
  ```

  **What you get**:

  - `pm2 list` / `pm2 logs` / `pm2 monit` work natively per agent (`su -m agentx -c 'pm2 list'`)
  - Per-agent `~/.pm2/logs/<bridge>-out-N.log` with built-in rotation
  - Each agent's pm2-daemon is its own crash domain
  - Bridge process is a direct child of pm2 (not a grandchild via apes-run)
  - pm2 inherits the agent's uid — no privilege expansion (the Nest stays as `_openape_nest`)

  **Per-agent ecosystem file**: written to `/var/openape/nest/agents/<name>/ecosystem.config.js`. Operators can hand-edit + reload via `apes run --as <agent> -- pm2 reload openape-bridge-<agent>`.

  **YOLO defaults extended** to cover `pm2 startOrReload *`, `pm2 delete openape-bridge-*`, `pm2 jlist` — re-run `apes nest authorize` after upgrading.

  **Operator setup** (one-time): pm2 must be on the host PATH for every agent. `npm i -g pm2` once on the host (the agents inherit `/opt/homebrew/bin/` via the host-PATH-capture from PR #376).

## 1.12.0

### Minor Changes

- [#379](https://github.com/openape-ai/openape/pull/379) [`157742d`](https://github.com/openape-ai/openape/commit/157742d8311298eab2a750836aac036bdbe2ae5a) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase B of the architecture simplification (#sim-arch): the Nest supervises chat-bridge processes in-daemon. New spawns no longer install per-agent system-domain launchd plists in `/Library/LaunchDaemons/` — there's just one launchd entry for the Nest itself, and it owns the rest.

  The supervisor (`apps/openape-nest/src/lib/supervisor.ts`) spawns `apes run --as <agent> --wait -- openape-chat-bridge` per registered agent, restarts on exit with bounded backoff. Same shape as the supervisor deleted in PR #365, but the PATH-inheritance bug that killed that one is gone since PR #376 retired the per-agent bun install (host-resolved binaries now).

  Spawn flow drops the bridge plist write + `launchctl bootstrap` block. `apes agents spawn --bridge` still writes the bridge `.env` to the agent's home (the Nest supervisor's child reads it via `resolveBridgeConfig`), but no plist + no `start.sh`.

  Existing per-agent bridge plists in `/Library/LaunchDaemons/eco.hofmann.apes.bridge.<agent>.plist` keep running on machines that haven't upgraded; new spawns use the Nest-supervisor path. Operators on Phase B can boot out the legacy plists manually once they confirm the Nest supervisor has taken over.

- [#380](https://github.com/openape-ai/openape/pull/380) [`3e56e49`](https://github.com/openape-ai/openape/commit/3e56e49fb3bf262059d702a539be0fc4862b4e6a) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase C of the architecture simplification (#sim-arch): troop-sync moves from per-agent launchd plist to a centralised loop in the Nest daemon.

  **Before**: every spawn dropped `/Library/LaunchDaemons/openape.troop.sync.<agent>.plist` with `StartInterval=300`. n agents → n separate plists, n separate apes-cli boot sequences every 5 min. n separate failure modes (each plist could be in a different bootout/bootstrap state).

  **After**: the Nest runs one `TroopSync` loop (`apps/openape-nest/src/lib/troop-sync.ts`) on a 5-minute timer that walks the registry and shells out to `apes run --as <agent> --wait -- apes agents sync` for each one serially. Same effect at the troop SP, far less moving parts.

  `apes agents spawn --bridge` no longer writes the troop-sync plist. Existing per-agent plists installed before this version keep running until manually booted out (they don't conflict — both paths just call `apes agents sync` and post the same heartbeat to troop).

- [#381](https://github.com/openape-ai/openape/pull/381) [`aedcb6b`](https://github.com/openape-ai/openape/commit/aedcb6bd2cbd3cb72287bbc03c1040bca3cc9d16) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase D of the architecture simplification (#sim-arch): the Nest is now a pure long-running CLIENT — no HTTP server.

  **What changed**: `apes nest <op>` no longer POSTs to `127.0.0.1:9091`. Instead, the CLI drops a JSON intent file into `$NEST_HOME/intents/<uuid>.json`; the Nest polls the directory, executes the intent, writes `<uuid>.response` back. UNIX permissions on the dir gate access (mode 770, group `_openape_nest`) — same trust model the localhost HTTP+DDISA layer used to enforce, just at filesystem level. Patrick is in the `_openape_nest` group post-`migrate-to-service-user`, so he can drop intents.

  **Why no HTTP**: the DDISA-grant gating at the HTTP boundary required a `nest spawn` grant per call; humans have no YOLO so each spawn would have re-prompted. Filesystem permissions sidestep that without losing security: anyone with shell access as Patrick can already do `apes run --as root --` directly.

  **Removed**:

  - `lib/auth.ts` (HTTP Bearer JWT verifier, JWKS cache)
  - `tests/auth-negative.sh` (smoke test for the HTTP auth, no longer applicable)
  - `apes nest status` command (consolidated into `apes nest list`)
  - `nest-grant-flow.ts` (grant request + reuse logic for the now-deleted HTTP path)

  **Added**:

  - `apps/openape-nest/src/lib/intent-channel.ts` — directory-watcher
  - `packages/apes/src/lib/nest-intent.ts` — CLI-side intent dispatcher
  - `OPENAPE_NEST_INTENT_DIR` env override for tests / non-default installs

  **Breaking change** for any operator that hand-rolled `curl http://127.0.0.1:9091/...` integrations: those break. Use `apes nest spawn|destroy|list` (which now drop intent files) or write JSON to the intents dir directly.

## 1.11.0

### Minor Changes

- [#378](https://github.com/openape-ai/openape/pull/378) [`5e69208`](https://github.com/openape-ai/openape/commit/5e69208ce524c40f0e19282b282d7e003f2e052f) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase A of the architecture simplification (#sim-arch): merge the chat-bridge daemon and the per-turn agent runtime into a single in-process loop.

  The bridge previously spawned `apes agents serve --rpc` as a long-lived stdio JSON-RPC subprocess and dispatched each turn through it. Now it imports `runLoop` from `@openape/apes` directly. Same loop, no IPC overhead, no second process to keep alive. Per-thread message history that used to live in the subprocess's `RpcSessionMap` now lives on each `ThreadSession` itself.

  `@openape/apes` exposes the runtime surface for in-process use:

  - `runLoop`, `RpcSessionMap` (classes/functions)
  - `ChatMessage`, `RunOptions`, `RunResult`, `RuntimeConfig`, `RunStreamHandlers`, `TraceEntry`, `ToolDefinition` (types)
  - `taskTools`, `TOOLS` (helpers)

  The `apes agents serve --rpc` command is preserved for backwards compatibility with bridge versions <1.3 that still spawn it via stdio.

  Net effect: one process per agent (the bridge), instead of two (bridge + serve). Faster turns (no IPC marshaling), simpler crash semantics, cron tasks share the same in-process runtime.

## 1.10.0

### Minor Changes

- [#376](https://github.com/openape-ai/openape/pull/376) [`5f90082`](https://github.com/openape-ai/openape/commit/5f900821fd5cfd5271738c019249bebc7b964c30) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Spawn 15× faster: replace per-agent bun bootstrap + `bun add -g` install with host-PATH capture.

  Previously every `apes [nest|agents] spawn --bridge` ran `curl https://bun.sh/install | bash` (if needed) followed by `bun add -g @openape/chat-bridge @openape/apes` _as the new agent user_ — adding ~30-90s to every spawn and ~100MB of disk per agent home, all duplicating tooling already installed on the host.

  Now the spawn flow calls `captureHostBinDirs()` once: resolves `node`, `openape-chat-bridge`, and `apes` via `which`, dedupes the dirs, and bakes them into the agent's launchd plist `EnvironmentVariables.PATH` + the `start.sh` PATH export. Every agent's bridge process inherits the host's tooling install. Spawn time on a Mac Mini went from ~60s to ~4s.

  **Operator setup**: install the bridge stack system-wide once before spawning agents:

  ```bash
  npm i -g @openape/apes @openape/chat-bridge
  ```

  If any of `node` / `openape-chat-bridge` / `apes` is missing on host PATH at spawn time, `apes agents spawn --bridge` fails fast with a pointer to the install command instead of silently bootstrapping a per-agent stack.

  Existing agents created before this version keep working (their plists still reference `~/.bun/bin`). They can be left as-is, or torn down + respawned to pick up the new shape.

## 1.9.0

### Minor Changes

- [#374](https://github.com/openape-ai/openape/pull/374) [`559569c`](https://github.com/openape-ai/openape/commit/559569cad20400ff4232b3d730c8fecc1df1aebd) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - `apes nest install --bridge-model <name>` persists the default bridge model used by every subsequent `apes [nest|agents] spawn --bridge`. Writes `APE_CHAT_BRIDGE_MODEL=<name>` into `~/litellm/.env` (the file `resolveBridgeConfig()` already reads at spawn time). Without this flag, the chat-bridge falls back to its built-in default `claude-haiku-4-5`, which 400s every chat-completion request when the user's LiteLLM proxy fronts only ChatGPT (or only Anthropic etc.).

## 1.8.1

### Patch Changes

- [#373](https://github.com/openape-ai/openape/pull/373) [`fe2a756`](https://github.com/openape-ai/openape/commit/fe2a756541583b075e0a259908c5d0ab105a610f) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Three small code-debt fixes:

  1. **`apes grants delegate --approval`** now actually works. The CLI was sending `approval: <value>` in the request body but the server reads `grant_type`. Result: every delegation got `grant_type: 'once'` regardless of `--approval timed|always`. Now the body uses the wire name `grant_type`. (CLI flag stays `--approval` for UX continuity — that's the term humans see in the IdP grant-approval UI.)

  2. **`registerAgentAtIdp` audit logs**. When an agent enrolls, the code paths `tryDelegatedEnrollToken` either succeeds (logs `[agent-bootstrap] using delegated token from grant <id> (sub=<owner>, act=<delegate>)`) or falls back (logs `[agent-bootstrap] no enroll-agent delegation from <owner> to <delegate> — falling back to direct enroll`). Surfaces during rollout whether the new token-exchange path is firing or whether the IdP's transitive-ownership fallback in `/api/enroll` is still doing the work.

  3. **`/api/enroll` transitive-ownership audit**. The fallback that walks the user store to attribute ownership when an agent enrols a sub-agent now logs a structured warning whenever it fires, including the operator command the human should run to set up the proper delegation grant. Same idea: visibility before removal.

## 1.8.0

### Minor Changes

- [#370](https://github.com/openape-ai/openape/pull/370) [`8ca96f1`](https://github.com/openape-ai/openape/commit/8ca96f10f7a0a9c8adc5afa5c8fd863f62342f6c) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Wire up delegation token-exchange end-to-end:

  - **`@openape/cli-auth`** exports `exchangeWithDelegation()` — posts an actor token + (optional) delegation grant id to the IdP's `/api/oauth/token-exchange` and returns a delegated access token whose `sub` is the delegator.
  - **`@openape/apes`** `registerAgentAtIdp()` now checks if the local caller is itself an agent. If yes, it lists the owner's approved grants, finds the first delegation grant for the `enroll-agent` audience, exchanges tokens, and presents the delegated access token as `Authorization: Bearer …` to `/api/enroll`. Falls back to the direct call (caller-as-requester) when no delegation is configured — the IdP's transitive-ownership lookup still covers that path until M3.
  - **IdP token-exchange** (`@openape/nuxt-auth-idp`) accepts a `delegation_grant_id` without requiring a `subject_token`: when the grant id is provided, the delegator identity is derived from `grant.delegator` and `subject_token` becomes optional (it can still be supplied for belt-and-suspenders verification, in which case its sub must match the grant's delegator).

  The `subject_token`-only path (RFC 8693 strict mode) and the new `delegation_grant_id`-only path coexist on the same endpoint.

- [#366](https://github.com/openape-ai/openape/pull/366) [`89aeb30`](https://github.com/openape-ai/openape/commit/89aeb30807068866c03e22bb2b769b760d3a721a) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Nest API now requires DDISA grant tokens for read endpoints. `apes nest list` and `apes nest status` go through the grant flow: request a `nest list`/`nest status` grant (audience `nest`), reuse any existing approved 'always'/'timed' grant for the exact same command, otherwise prompt the human once with `grant_type: 'always'` so subsequent calls reuse silently. The grant token is presented as `Authorization: Bearer …` to the Nest, which verifies it against the IdP's JWKS and matches the embedded `command` claim against the route. Each call leaves an audit record at the IdP. Mutating endpoints (POST /agents, DELETE /agents/:name) keep the unauthenticated path for now — gated in the next release. New audience `nest` registered in the audience-bucket whitelist (commands bucket).

- [#367](https://github.com/openape-ai/openape/pull/367) [`78e6b87`](https://github.com/openape-ai/openape/commit/78e6b8717ce8d874d315dfab8d929c08ba3b98e0) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Mutating Nest endpoints (`POST /agents`, `DELETE /agents/:name`) now require DDISA grant tokens. New CLI commands:

  - `apes nest spawn <name>` — provisions an agent via the Nest. Grant `command` is just `['nest','spawn']` (no name baked in), so a single human approval covers all future spawns. Trade-off: a compromised local process running as the human can spawn arbitrary agents under that grant. Acceptable because spawn is reversible (`apes nest destroy`) and creates auditable IdP records.
  - `apes nest destroy <name>` — tears down an agent. Grant `command` IS per-name (`['nest','destroy','<name>']`) deliberately, so destroying any specific agent is its own approval — destructive ops keep tighter scoping.

  `curl POST /agents` and `curl DELETE /agents/:name` without `Authorization: Bearer …` now return 401. Existing scripts that hit the Nest directly need to migrate to `apes nest spawn|destroy` or implement the grant flow themselves.

  YOLO defaults extended with `nest spawn` (wildcard-name) and `nest destroy *` (per-name pattern).

### Patch Changes

- [#363](https://github.com/openape-ai/openape/pull/363) [`a25180a`](https://github.com/openape-ai/openape/commit/a25180abb6d718881ace7b1776f136ee36e1554e) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix nest bridge supervisor — three bugs that conspired to flood the human with approval prompts on every supervisor restart:

  1. **Wrong YOLO pattern**: The default nest YOLO allow-pattern was `apes run --as * -- openape-chat-bridge`, but escapes-helper unwraps the `apes run --as <agent> --` prefix before submitting the grant request to the IdP. So the actual target string the YOLO evaluator saw was just `openape-chat-bridge`. The pattern is now `openape-chat-bridge` (just the inner command) — `apes nest authorize` re-runs apply the corrected default.

  2. **Missing `--wait`**: The supervisor invoked `apes run --as <agent> -- openape-chat-bridge` without `--wait`. Even when YOLO auto-approved the grant server-side, the CLI returned exit 75 (EX_TEMPFAIL) the moment the grant was created — before the CLI observed the approval. Added `--wait` to mirror the spawn-handler.

  3. **Doubly-nested registry path**: `agents.json` was written to `~/.openape/nest/.openape/nest/agents.json` because `homedir()` already returned `~/.openape/nest` (the launchd-set daemon HOME) and the registry then joined `.openape/nest/` again on top. Registry now lives directly at `$HOME/agents.json`. Existing installs need a one-time `mv ~/.openape/nest/.openape/nest/agents.json ~/.openape/nest/agents.json`.

- [#364](https://github.com/openape-ai/openape/pull/364) [`c5920e0`](https://github.com/openape-ai/openape/commit/c5920e0b598377d212a3b2ace7fed2b414e82a57) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix `apes agents spawn` writing the wrong `owner_email` into the new agent's `auth.json` when the spawn happens through a Nest (or any non-human caller). The IdP's `/api/enroll` resolves the owner transitively (the human at the top of the chain), but the cli was still writing `auth.email` (= the local caller, e.g. the Nest itself) into the agent's local auth.json. Result: the agent's auth.json carried the Nest's email as `owner_email`, and troop's `/api/agents/me/sync` rejected the call with a 400 because the owner-domain encoded in the agent's email (`patrick+hofmann_eco`) didn't match the locally-stored `owner_email`'s domain (`id.openape.ai`). Now uses `registration.owner` from the IdP response, matching what the server actually persisted.

## 1.7.1

### Patch Changes

- [`e8f66cf`](https://github.com/openape-ai/openape/commit/e8f66cf3ab2c756337ff70b85fe7fede29c7ea1d) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - `apes agents spawn`'s setup.sh now exports a wide PATH at the top — escapes-spawned scripts inherit a minimal PATH that excludes `/usr/sbin` (where chown / dscl / pwpolicy live), so privileged setup hit `chown: command not found` at line 131. Now resolves without forcing absolute paths.

## 1.7.0

### Minor Changes

- [#359](https://github.com/openape-ai/openape/pull/359) [`68e8f16`](https://github.com/openape-ai/openape/commit/68e8f164e97538ee919d097ec798dd3a315c4e9b) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - New top-level `apes yolo` command for managing YOLO-policies on DDISA agents you own:

  - `apes yolo set <email> --mode allow-list --allow "apes agents spawn *,..."` — write/update policy
  - `apes yolo show <email>` — read current policy (--json for scripts)
  - `apes yolo clear <email>` — remove policy (subsequent grants need human approval)

  `apes nest authorize` is now a thin wrapper that shells out to `apes yolo set` instead of doing raw `fetch` calls. Same end-state for the user; YOLO-management is now reusable for non-nest agents too.

  Plus: `apes nest install` now adds `--wait` to the daemon's spawn invocation so the YOLO-auto-approved grant actually executes (without `--wait`, apes run exits 75 EX_TEMPFAIL the moment the grant is created, even when YOLO approves milliseconds later).

## 1.6.1

### Patch Changes

- [#358](https://github.com/openape-ai/openape/pull/358) [`f56ea4b`](https://github.com/openape-ai/openape/commit/f56ea4b9dfb3f9aa3085d9b8afee6c1240506da5) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - `apes nest authorize` default allow_patterns now also covers the inner setup.sh-grant that `apes agents spawn` shells out to (`bash *apes-spawn-*setup.sh`). Without it, the outer spawn auto-approves but the inner privileged setup blocks on a fresh DDISA prompt.

## 1.6.0

### Minor Changes

- [#356](https://github.com/openape-ai/openape/pull/356) [`7fc3ebe`](https://github.com/openape-ai/openape/commit/7fc3ebef37a9a096052bdfebfc5ac37534fd1326) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Stage 1.5/1.6/1.7 of the Nest plan: zero-prompt spawn via Nest-as-DDISA-Agent + YOLO-policy.

  - `apes nest enroll`: registers the local nest as its own DDISA-agent (`nest-<host>+<owner>+<dom>@id.openape.ai`), keypair + auth.json under `~/.openape/nest/.config/apes/`. Owner is the human user; uses the existing `registerAgentAtIdp` + `issueAgentToken` flow.

  - `apes nest authorize` (rewritten): PUTs a YOLO-policy on the nest-agent's email at `id.openape.ai/api/users/<nest-email>/yolo-policy` with mode=`allow-list` and default allow_patterns covering `apes agents spawn|destroy|sync` plus the bridge-supervisor invocation. Patterns are bash-style globs evaluated against the joined command line, matching the existing yolo_policies semantics.

  - `apes nest install`: launchd plist now sets `HOME=~/.openape/nest`, so apes-CLI subprocesses the daemon spawns automatically read the nest's own auth.json — no env-var plumbing needed; the YOLO-policy on the nest-identity gates them at the IdP grant-creation hook.

  After enroll + authorize: `POST http://127.0.0.1:9091/agents` runs without DDISA prompts.

## 1.5.0

### Minor Changes

- [#355](https://github.com/openape-ai/openape/pull/355) [`c902dd0`](https://github.com/openape-ai/openape/commit/c902dd092123bcdcbc91468f456769f781fe0841) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - `apes nest install` now bundles + writes an `apes-agents.toml` shapes adapter to `~/.openape/shapes/adapters/`, and a new `apes nest authorize` command requests a single capability-grant covering all agent names via selector glob `name=*`. After approving once as Always, every nest-driven `apes agents spawn|destroy|sync` reuses the grant silently — selectorValueMatches treats `*` as a regex glob (existing logic in @openape/grants).

  Without the adapter, plain run-grants do exact-arg matching and never reuse across different agent names; this closes that gap so the nest-daemon's zero-prompt spawn loop actually works.

## 1.4.0

### Minor Changes

- [#353](https://github.com/openape-ai/openape/pull/353) [`bcf0646`](https://github.com/openape-ai/openape/commit/bcf0646a2248e3be7588b7ddcaa91b67f11baed3) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - **Stage 1 of the Nest control-plane** (per [plan 01KR5TXQXWDC1YDESJJYTPFFMK](https://plans.openape.ai/plans/01KR5TXQXWDC1YDESJJYTPFFMK)). The Nest is a local daemon that hosts agents on a single computer — once installed, `apes agents spawn` becomes fast (no per-spawn DDISA approvals required after the one-time always-grant) and per-agent launchd plists get replaced by a single supervised process tree.

  **New package** `@openape/nest`: HTTP daemon on `127.0.0.1:9091` with `/agents` (POST/DELETE/GET) and `/status` endpoints; persistent registry at `~/.openape/nest/agents.json`; supervisor for chat-bridge children with bounded backoff restart.

  **New `@openape/apes` verbs**:

  - `apes nest install` — writes `~/Library/LaunchAgents/ai.openape.nest.plist`, bootstraps it, prints next-step instructions for the always-grant
  - `apes nest status` — talks to the daemon, lists supervised processes
  - `apes nest uninstall` — bootouts + removes the plist (registry preserved)

  Stage 1 MVP runs the nest as the human user (eventual migration to a dedicated `_openape_nest` service-account is Stage 1.5). Migration of existing agents from per-agent launchd plists into supervisor-managed children comes in a follow-up PR.

## 1.3.1

### Patch Changes

- [#350](https://github.com/openape-ai/openape/pull/350) [`07a8346`](https://github.com/openape-ai/openape/commit/07a834625f076d0d1faa8e6c551c38e4f81fa95d) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix two issues that surfaced on first cron-task DM:

  1. **Tool names rejected by ChatGPT API**: catalog tool names like `time.now` failed the Responses API's `^[a-zA-Z0-9_-]+$` pattern via LiteLLM. Wire-encode dots to underscores when sending tools to the LLM (`time.now` → `time_now`); decode the model's tool_call back to the local catalog name.

  2. **Task DMs landing in main thread instead of dedicated thread**: cron-runner now explicitly POSTs `/api/rooms/<id>/threads` with the task's name on first run, then reuses the returned threadId for every subsequent run of that task.

## 1.3.0

### Minor Changes

- [#348](https://github.com/openape-ai/openape/pull/348) [`8fa08c4`](https://github.com/openape-ai/openape/commit/8fa08c4c9a76b328efd66325e43b5da5b99dd22a) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Cron tasks now run **inside the chat-bridge daemon** instead of via per-task launchd plists. One process, one LiteLLM config (the bridge's), one WebSocket to chat.openape.ai. The bridge's existing `ApesRpcSession` is reused for task fires — fixed `session_id = task:<taskId>` so the runtime carries memory across runs (within its evict TTL), fixed chat thread per task (persisted to `~/.openape/agent/task-threads.json`) so all runs of one task land in the same chat thread instead of fanning out into N independent DMs.

  `apes agents sync` no longer reconciles per-task launchd plists. The chat-bridge's `CronRunner` ticks every 60s, reads `~/.openape/agent/tasks/*.json`, fires anything whose cron matches the current minute. `apes agents run` is now optional (kept for ad-hoc invocation but no longer scheduled by the bridge stack).

## 1.2.1

### Patch Changes

- [#347](https://github.com/openape-ai/openape/pull/347) [`31e872a`](https://github.com/openape-ai/openape/commit/31e872a51c688c48018600a6c92a8e0ff745fb24) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix cron tasks never firing on hidden service-account agents. Tasks plists were going to `~/Library/LaunchAgents/` and `launchctl bootstrap gui/<uid>` — same dead-end as the troop sync plist had before #338. Move task plists to `/Library/LaunchDaemons/` with `UserName=<agent>`, bootstrap into `system` domain. Sync daemon now runs as ROOT (so it can write into `/Library/LaunchDaemons/` and bootstrap system-domain jobs); chowns its writes in the agent's `$HOME` back to the agent uid via stat(`$HOME`).

## 1.2.0

### Minor Changes

- [#346](https://github.com/openape-ai/openape/pull/346) [`841c8ff`](https://github.com/openape-ai/openape/commit/841c8ff94cdff03c9c4a7af14f389699b4aa0fbf) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Agent-level system prompt + task-output-to-chat DM. Tasks now carry a `userPrompt` (the imperative job description) instead of a per-task `systemPrompt`; the agent itself owns the system prompt (persona, behaviour rules) and it applies to both cron task runs and live chat-bridge messages. After every cron run, `apes agents run` posts the `final_message` as a chat DM from the agent to its owner — best-effort, silently skips when the contact isn't accepted yet.

  Sync now writes `~/.openape/agent/agent.json` with `{systemPrompt}`; the chat-bridge daemon re-reads it per inbound message so owner-side prompt edits via the troop UI propagate within one sync cycle (~5min) without a daemon restart.

  Migration: existing per-task `system_prompt` columns get renamed to `user_prompt` by the troop server's idempotent migration; semantically the old content was always task-imperative anyway.

## 1.1.1

### Patch Changes

- [#345](https://github.com/openape-ai/openape/pull/345) [`11d0ab5`](https://github.com/openape-ai/openape/commit/11d0ab5a2a878fbf03d39eec99ecd57a3b65d06e) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Auto-install `bun` during `apes agents spawn --bridge` if the agent user doesn't have it. Hidden service-account agents have a clean $HOME and no system-wide bun on macOS (bun installs per-user via the curl-bash installer; brew doesn't ship it), so `bun add -g @openape/chat-bridge @openape/apes` was failing with `bun: command not found` on every fresh bridged spawn. Now the bridge install block runs the official bun installer first if needed, then proceeds with the bun add — idempotent for re-spawns.

## 1.1.0

### Minor Changes

- [#344](https://github.com/openape-ai/openape/pull/344) [`d7cd4fa`](https://github.com/openape-ai/openape/commit/d7cd4fa90e7bb83664f8e0d7c32902fed1ef87e0) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Add `--bridge-model` flag to `apes agents spawn` and `APE_CHAT_BRIDGE_MODEL` env-var support. Lets you spawn a bridged agent against a LiteLLM proxy that doesn't route the bridge's built-in default (`claude-haiku-4-5`) — e.g. a proxy fronting only ChatGPT subscription needs `gpt-5.4`. Without this the bridge daemon would 404 on every chat message because the proxy doesn't know the default model name.

## 1.0.5

### Patch Changes

- [#340](https://github.com/openape-ai/openape/pull/340) [`5597fec`](https://github.com/openape-ai/openape/commit/5597fec6d1a334de52411f89a45e0970c0510a39) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix `apes agents sync` rejecting every spawned agent with "expected an agent+name+domain@idp address". The validator was checking `email.startsWith('agent+')` but the IdP's `deriveAgentEmail` produces `<safeName>-<ownerHash>+<owner-local>+<owner-domain>@<idp-host>` — the `+` is embedded, not the prefix. Switch to checking for `+` anywhere (the subaddressing distinguishes agents from humans). Same fix to `agentNameFromEmail` parser.

## 1.0.4

### Patch Changes

- [#339](https://github.com/openape-ai/openape/pull/339) [`4e465d4`](https://github.com/openape-ai/openape/commit/4e465d41e4b1f20fdefa428d35a65159f066e12b) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Add PATH to the troop sync plist's EnvironmentVariables so the daemon can find `node` (and `bun`). launchd defaults to `/usr/bin:/bin:/usr/sbin:/sbin` — too narrow for the apes binary's `#!/usr/bin/env node` shebang. Without this the sync log filled with `env: node: No such file or directory` and the agent never reached troop.openape.ai.

## 1.0.3

### Patch Changes

- [#338](https://github.com/openape-ai/openape/pull/338) [`1b709c8`](https://github.com/openape-ai/openape/commit/1b709c87d2a7659f5165235510b5cef8c76a91ba) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Move troop sync plist from `~/Library/LaunchAgents/` (gui/<uid> domain) to `/Library/LaunchDaemons/` (system domain) with a `UserName` key — same pattern the bridge has always used. Hidden service accounts (IsHidden=1) never log in graphically, so their per-user launchd domain doesn't exist; `launchctl bootstrap gui/<uid>` was failing with "Domain does not support specified action" for every spawned agent. System-domain bootstrap doesn't need a user session — launchd runs the daemon as the agent uid via `UserName`.

  Side benefit: removes the `su -c '...'` wrapper, so no more shell-quoting issues with `set -u` inside the inner shell.

## 1.0.2

### Patch Changes

- [#337](https://github.com/openape-ai/openape/pull/337) [`06b4f10`](https://github.com/openape-ai/openape/commit/06b4f106b04a4e66ee9af9a058448961728ea35e) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix `apes agents spawn` exiting nonzero after macOS user creation. Two related bugs:

  1. **`$NAME` unbound inside `su - $NAME -c '...'`**: the inner shell starts fresh and doesn't inherit `NAME` from setup.sh. With `set -u`, the first `$NAME` reference inside the single-quoted block crashed the inner shell, propagated through `set -e` in setup.sh, and made the whole spawn fail despite the user being created. Fix: interpolate the literal name at TS-template time so the inner shell never sees a bash variable.

  2. **`launchctl bootstrap gui/<uid>` fails for hidden service accounts**: spawned agents have `IsHidden=1` and never log in graphically, so the user's `gui/<uid>` launchd domain doesn't exist. `bootstrap` fails with "Domain does not support specified action". Fix: prefix with `launchctl asuser <uid>` (run as root in setup.sh) which bootstraps launchd for that uid first, then the inner bootstrap runs in the now-existing domain.

  Repro: any fresh `apes agents spawn <name>` failed with `Command failed: bash setup.sh` while leaving the macOS user + plist files in place but no active launchd job. Manual `launchctl bootstrap` later would have hit the same domain error.

## 1.0.1

### Patch Changes

- [#335](https://github.com/openape-ai/openape/pull/335) [`26add22`](https://github.com/openape-ai/openape/commit/26add22869f5347dcf0b724a50ae5fa1bf8e1c2b) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix `apes agents spawn` crashing on the troop-sync-install line with `setup.sh: line N: NAME…: unbound variable`. With `set -u`, `$NAME…` was parsed as a variable named `NAME…` (the U+2026 ellipsis got eaten into the identifier). Use `${NAME}…` so the brace cleanly terminates the variable name. Same fix applied to the bridge-install echo.

## 1.0.0

### Major Changes

- [#331](https://github.com/openape-ai/openape/pull/331) [`f941d7b`](https://github.com/openape-ai/openape/commit/f941d7b212aa3c4ce6301d134ff6076ae6520365) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - **BREAKING**: SP renamed from `tribe` to `troop` ("troop" is the primatologically-correct collective for apes).

  Migration for self-hosted agents:

  - Env var: `OPENAPE_TRIBE_URL` → `OPENAPE_TROOP_URL`
  - Default URL: `https://tribe.openape.ai` → `https://troop.openape.ai`
  - launchd plist labels: `openape.tribe.sync.<agent>` → `openape.troop.sync.<agent>`,
    `openape.tribe.<agent>.<task>` → `openape.troop.<agent>.<task>`

  After upgrading, run `apes agents spawn <name>` again to re-bootstrap with new
  plist labels, or manually `launchctl bootout` the old labels and re-sync.

## 0.32.0

### Minor Changes

- [#329](https://github.com/openape-ai/openape/pull/329) [`dd146a7`](https://github.com/openape-ai/openape/commit/dd146a739d11e5a1d63d4ee5def57957c52fcbee) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Troop agent runtime + sync (M4-M6 of openape-troop). New CLI subcommands:

  - `apes agents sync` — pulls task list from `troop.openape.ai`, reconciles `~/Library/LaunchAgents/openape.troop.<agent>.<task>.plist`, caches task specs to `~/.openape/agent/tasks/`
  - `apes agents run <task_id>` — launchd-invoked one-shot: loads cached spec, runs the LiteLLM tool-call loop, posts a run record to troop
  - `apes agents serve --rpc` — long-running stdio RPC server (replaces `pi --mode rpc` for chat-bridge in M8); line-delimited JSON in/out, conversation memory keyed by `session_id`

  Built-in tools shipped: `time.now`, `http.get/post`, `file.read/write` (jailed to $HOME), `tasks.list/create` (via @openape/ape-tasks), `mail.list/search` (via o365-cli).

  `apes agents spawn` integration:

  - Installs `~/Library/LaunchAgents/openape.troop.sync.<agent>.plist` (every 5min, RunAtLoad fires immediately) so the agent registers at troop within seconds of spawn
  - Drops `@mariozechner/pi-coding-agent` from the bun-install step (chat-bridge spawns `apes agents serve --rpc` directly in M8)
  - Drops the pi-extension write at `~/.pi/agent/extensions/litellm.ts`
  - Bridge env file relocates from `~/.pi/agent/.env` to `~/Library/Application Support/openape/bridge/.env`
  - Spawn output now prints `🔗 Troop: https://troop.openape.ai/agents/<name>`

  Override the troop endpoint via `OPENAPE_TROOP_URL` env var (default `https://troop.openape.ai`).

## 0.31.3

### Patch Changes

- Updated dependencies [[`362390c`](https://github.com/openape-ai/openape/commit/362390c6da33bb6334ac22830336b5e4903e157c)]:
  - @openape/core@0.16.0
  - @openape/grants@0.11.5
  - @openape/proxy@0.4.3

## 0.31.2

### Patch Changes

- Updated dependencies [[`38c5c3c`](https://github.com/openape-ai/openape/commit/38c5c3cf1c2a4b11c4942e4e9eee6ddcec2deff9)]:
  - @openape/core@0.15.0
  - @openape/grants@0.11.4
  - @openape/proxy@0.4.2

## 0.31.1

### Patch Changes

- Updated dependencies [[`146a5a3`](https://github.com/openape-ai/openape/commit/146a5a3dd3960b42c7f40a0ece0f7c361934c323)]:
  - @openape/core@0.14.0
  - @openape/grants@0.11.3
  - @openape/proxy@0.4.1

## 0.31.0

### Minor Changes

- [#260](https://github.com/openape-ai/openape/pull/260) [`6539c9b`](https://github.com/openape-ai/openape/commit/6539c9b290b9d9f062f54dfdf5378957ee668018) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - In-process Ed25519 challenge-response refresh for agent IdP tokens (closes #259).

  Agent tokens have no `refresh_token` — the IdP's `/agent/authenticate` endpoint deliberately doesn't issue one. Before this change, `ensureFreshIdpAuth` threw `NotLoggedInError` when an agent token expired, which left the chat-bridge daemon in a 1-hour crash-restart loop: launchd's KeepAlive bounced the process every time the cached token aged out, the start.sh shell-out re-ran `apes login` to mint a fresh one, and the cycle repeated.

  - **`@openape/cli-auth`** now refreshes agent tokens in-process. When `auth.json.refresh_token` is missing but `key_path` (or `~/.ssh/id_ed25519`) is present, `ensureFreshIdpAuth` signs a new challenge against the IdP's `/agent/challenge` + `/agent/authenticate` endpoints — same flow `apes login --key` uses — and persists the rotated token. The chat-bridge daemon now stays connected across the 1h expiry boundary.
  - **`@openape/apes`**: `apes login` and `apes agents spawn` write `key_path` into auth.json so any cli-auth consumer (chat-bridge, ape-tasks, ape-plans, …) inherits the in-process refresh capability for free. `saveAuth` merges with existing fields so older spawns retain `owner_email` across logins (mirrors PR #257's cli-auth fix). `start.sh` no longer shells out to `apes login` at boot — the install is now ~3-5s instead of doing the legacy refresh dance.
  - **`@openape/cli-auth`** new public types: `IdpAuth.key_path` (optional, absolute path to the Ed25519 signing key).

## 0.30.0

### Minor Changes

- [#258](https://github.com/openape-ai/openape/pull/258) [`1023309`](https://github.com/openape-ai/openape/commit/10233090ef09d049f82c4a8b6ae73325c8113416) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - `apes agents spawn --bridge` now stamps `OPENAPE_OWNER_EMAIL` into the bridge daemon's launchd plist `EnvironmentVariables` block, plus its start.sh logs the actual `apes login` failure to stderr instead of silently swallowing it.

  Together these mean a freshly-spawned agent is robust to the cli-auth merge bug from the previous patch: the bridge can resolve its owner from the env var even if `auth.json` ever gets clobbered, and any login refresh failure is debuggable from the daemon's stderr log without an interactive grant approval.

## 0.29.0

### Minor Changes

- [#253](https://github.com/openape-ai/openape/pull/253) [`1b05c4b`](https://github.com/openape-ai/openape/commit/1b05c4b0c3b9cb61e353979d1b66e3b4670cf22d) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase A frontend + CLI:

  - chat.openape.ai webapp shows contacts (incoming pending, connected, outgoing pending) with accept/decline/cancel actions and an "Add contact" dialog. Mobile-first. Live-updates via WS membership-\* frames.
  - `@openape/ape-chat`: new `contacts list / add / accept / remove` subcommand.
  - `@openape/apes`: new `apes agents allow <agent> <peer-email>` — adds peer to the agent's bridge-allowlist file so the bridge auto-accepts that peer's contact request.
  - chat-bridge polls the allowlist + pending contacts every 30s while connected, so an `apes agents allow` change takes effect within half a minute without a daemon restart.

## 0.28.0

### Minor Changes

- [#251](https://github.com/openape-ai/openape/pull/251) [`c314e7a`](https://github.com/openape-ai/openape/commit/c314e7a3f6594e097166024ac6465bbb2c181a80) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase A backend — chat-app gains a `contacts` table + friend-request lifecycle. `apes agents spawn --bridge` now POSTs `/api/contacts` instead of creating a DM room directly; the bridge daemon accepts pending requests on first connect, completing the bilateral handshake without manual intervention. Direct `POST /api/rooms { kind: 'dm' }` is now rejected — DMs are owned by the contacts model and lazy-created on bilateral accept.

## 0.27.0

### Minor Changes

- [#249](https://github.com/openape-ai/openape/pull/249) [`ee32010`](https://github.com/openape-ai/openape/commit/ee32010bbed125e12ab4012e49f5f47e3b92e2d8) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Bridge model shifts to 1:1-only. `apes agents spawn --bridge` no longer takes `--bridge-room <name>` — it auto-creates a DM between the spawning user and the new agent. The chat-app UI hides channels (group chats) until the contacts model lands; agents in shared rooms produce reply-loops between agents and there's no reliable way to filter agent-from-human messages yet. Existing channels are not deleted, just hidden from the room list. Direct URL access to a channel still works for back-compat.

## 0.26.1

### Patch Changes

- [#248](https://github.com/openape-ai/openape/pull/248) [`5b0f7cc`](https://github.com/openape-ai/openape/commit/5b0f7cc681ec6b3fccf08a780a38c3039c841c8b) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix bridge PATH on apes 0.26.0: bun symlinks live in `~/.bun/bin/` not `~/.bun/install/global/bin/`, so launchd's `exec openape-chat-bridge` was failing with "command not found" and crashlooping. One-char fix in plist + start.sh. Existing agents need their plist+start.sh patched in place (or destroy + re-spawn).

## 0.26.0

### Minor Changes

- [`21b0b26`](https://github.com/openape-ai/openape/commit/21b0b26c7ae6c283f47ddd0ddc4f21d8c72b1646) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Bridge boot time dropped from ~75s to ~5s. `apes agents spawn --bridge` now bun-installs the bridge stack (chat-bridge + apes + pi, ~1300 packages) **once** during spawn — start.sh becomes a slim launcher that only refreshes the agent's IdP token, drops the litellm pi extension if missing, and execs the bridge. The trade-off is no auto-update on each boot — to upgrade an agent's bridge after a release: `apes run --as <name> -- bun update -g @openape/chat-bridge`.

  Existing agents (npm-installed in `~/.npm-global`) keep working — the new layout only kicks in for fresh `spawn --bridge` calls. Re-spawn to migrate.

## 0.25.2

### Patch Changes

- [#245](https://github.com/openape-ai/openape/pull/245) [`5ef61a8`](https://github.com/openape-ai/openape/commit/5ef61a8d0dee1fb0f032f16098275c6c89118a09) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix bridge crashloop on 1h agent IdP token expiry. Agents auth via SSH-key signing — the resulting IdP token has no refresh_token and dies after ~1h. The bridge then crashloops because launchd's KeepAlive restarts it but the cached token is still expired. Fix: spawn `--bridge` start.sh now installs `@openape/apes` and runs `apes login <email> --idp <idp>` (key-based, non-interactive) before exec'ing the bridge — every launchd boot produces a fresh ~1h token, recovery gap on the hourly mark drops to ~10s instead of permanent breakage.

## 0.25.1

### Patch Changes

- [`3c0d06c`](https://github.com/openape-ai/openape/commit/3c0d06c35e3974de009a19f7041e88e1e77421ae) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - `@openape/chat-bridge` rewritten to drive pi via its RPC mode (`pi --mode rpc`) instead of one-shot `pi --print` per message. One long-lived pi subprocess per chat room means the conversation now has memory across messages — "what's 7×6?" then "and ×2?" produces "84" not a confused "what do you mean ×2?". The agent's reply also visibly grows in real time as pi streams `text_delta` events: bridge posts a placeholder message and PATCHes it progressively (throttled ~300ms).

  `@openape/apes`: bridge `start.sh` now always pulls `@openape/chat-bridge@latest` on boot, so restarting the launchd daemon picks up new bridge versions without manual intervention. Pi extension setup unchanged.

## 0.25.0

### Minor Changes

- [`47f88a5`](https://github.com/openape-ai/openape/commit/47f88a5ac0a2b0aee9d7687adc8d41331051f545) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - `apes agents destroy` now uses sudo + a silent password prompt instead of `apes run --as root` + a visible password prompt. One credential, one interaction. The DDISA grant approval was redundant: sysadminctl required the local admin password regardless. The previous `consola.prompt({ mask: '*' })` showed the password in plaintext on terminals (Warp, etc.) where the mask option is ignored — replaced with native raw-mode stdin that disables echo entirely. `APES_ADMIN_PASSWORD` env var still works for non-interactive use.

## 0.24.0

### Minor Changes

- [#237](https://github.com/openape-ai/openape/pull/237) [`7fe49ef`](https://github.com/openape-ai/openape/commit/7fe49ef0ca5f3f42dfa810a475c6e6971f785efc) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Polish `apes agents spawn --bridge` for production use:

  - Bridge plist now installed as a system-wide LaunchDaemon at `/Library/LaunchDaemons/eco.hofmann.apes.bridge.<agent>.plist` with `<UserName>` set to the agent. Boots without anyone being logged in (the previous LaunchAgent in `~/Library/LaunchAgents/` couldn't bootstrap into a non-existent gui domain for hidden service accounts). Cleanup added to `destroy`.
  - Bridge `start.sh` now self-installs both `@openape/chat-bridge` and `@mariozechner/pi-coding-agent` via npm into a per-user `~/.npm-global` prefix, plus drops the litellm pi extension if missing. Idempotent. No more manual per-agent setup.
  - Added `--bridge-room <name>` flag: after spawn, creates (or finds) a chat.openape.ai room with the given name and adds the new agent as a member, using the spawning user's IdP bearer. Soft-fails with a hint if chat is unreachable.

## 0.23.0

### Minor Changes

- [#235](https://github.com/openape-ai/openape/pull/235) [`0aac1a1`](https://github.com/openape-ai/openape/commit/0aac1a1a34b5841c4b0ca7f2bcd854f23940d663) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Add `apes agents spawn --bridge` to install the openape-chat-bridge daemon for the spawned agent. Drops a launchd plist + start script + `~/.pi/agent/.env` into the agent's home, so the agent auto-answers chat.openape.ai messages by forwarding them to a local LLM CLI (default: pi). LITELLM_API_KEY + LITELLM_BASE_URL default from `~/litellm/.env` (the spawning user's hand-crafted proxy setup); override via `--bridge-key` / `--bridge-base-url`. `apes agents destroy` already cascades cleanup via `launchctl bootout user/$UID_OF` + `rm -rf $HOME_DIR`, so no destroy changes were needed.

## 0.22.1

### Patch Changes

- [#228](https://github.com/openape-ai/openape/pull/228) [`d2bdd6c`](https://github.com/openape-ai/openape/commit/d2bdd6cc11ad021e4a5e6612cd91b991cd801727) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix: `apes agents destroy` no longer hangs ~5min and fails with `eUndefinedError -14987` from `DSRecord.m`.

  Root cause: the teardown script ran inside `escapes`' setuid-root context, which has no audit/PAM session attached (`AUDIT_SESSION_ID=unset`). Plain `sysadminctl -deleteUser` and `dscl . -delete` both made an implicit "is current session admin?" check via opendirectoryd; with no session bound, the lookup hung 5min and exited `-14987`.

  Fix: pass `-adminUser/-adminPassword` to `sysadminctl` so it authenticates against DirectoryService directly instead of probing the session. The local admin password is collected from `APES_ADMIN_PASSWORD` (preferred) or a silent prompt, then piped via stdin into the teardown script — never as an argv element (would leak via `ps` and the escapes audit log). With this change the user record delete completes in ~1s.

## 0.22.0

### Minor Changes

- [#223](https://github.com/openape-ai/openape/pull/223) [`23cc69b`](https://github.com/openape-ai/openape/commit/23cc69b795e19ece74e1fa58896d4fc64855cd86) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - apes: warn when the installed version is behind latest @openape/apes on npm

  Once-a-day check against `https://registry.npmjs.org/@openape/apes/latest`. If the local version is older, prints a yellow stderr warning before the command runs:

  ```
  WARN  apes 0.21.2 is behind latest @openape/apes@0.22.0. Run `npm i -g @openape/apes@latest` to update.
  ```

  Cached for 24h at `~/.config/apes/.version-check.json` so it's a one-time network hit per day. The fetch is bounded by a 2s `AbortSignal` so command startup never blocks for long even when offline. Suppress with `APES_NO_UPDATE_CHECK=1` (CI, scripts that pin a specific version).

  Catches the foot-gun where you forgot `npm i -g` after a release and silently keep using behavior that's been fixed upstream.

## 0.21.2

### Patch Changes

- [`a544bd8`](https://github.com/openape-ai/openape/commit/a544bd8c4f20a34cdbd889a94d19bf17c78a8225) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - apes: `apes run --wait` throws a clear "approval timed out" error instead of the misleading "Grant is not approved (status: pending)"

  `runAudienceMode`'s wait-loop used to fall through silently on timeout — straight to the token-fetch — and the server then rejected with "Grant is not approved (status: pending)" because… well, it wasn't. Users had no way to tell timeout from a real auth failure.

  Two changes:

  - Track whether the loop exited via approval (break) or timeout (condition false). On timeout, throw `CliError("Grant approval timed out after Xmin (still pending). Check inbox at <url>…")` instead of falling through.
  - Bump the default wait budget from 5 min to 15 min. Human-in-the-loop approvals over phone notifications routinely take longer than 5 min.

  Also prints the approval URL right after the grant request so users don't need to dig through their inbox.

## 0.21.1

### Patch Changes

- [#222](https://github.com/openape-ai/openape/pull/222) [`4bef7c9`](https://github.com/openape-ai/openape/commit/4bef7c988b94813d060861a261d723bfca1541f9) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - apes: `apes agents destroy` refuses with a clear hint when there's no TTY (was: opaque `uv_tty_init returned EINVAL` crash)

  Calling `apes agents destroy <name>` from a non-TTY context (CI, subprocess, automation) used to crash with an unreadable Node-internal stack trace because `consola.prompt` requires a controlling terminal. Detect `!process.stdin.isTTY` upfront and refuse with `"No TTY available for the interactive confirmation. Re-run with --force …"` instead.

  The `--force` flag has always existed for exactly this case; we just weren't surfacing it. No behavior change for interactive use.

## 0.21.0

### Minor Changes

- [#221](https://github.com/openape-ai/openape/pull/221) [`d3c590e`](https://github.com/openape-ai/openape/commit/d3c590ee7b1ee88107bcea1ba554dcba4e81ea3b) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - apes: `apes agents spawn` can pre-install a Claude Code OAuth token

  `apes agents spawn agent-x --claude-token sk-ant-oat01-…` (or `--claude-token-stdin` for the paranoid form) now writes the token to `~/.config/openape/claude-token.env` (chmod 600) under the new agent's HOME and adds source-lines to `.zshenv` and `.profile`. The agent can immediately run `claude -p "…"` without an interactive auth step — useful for unattended setups where you've already run `claude setup-token` once on your trusted machine and want to seed the agent with the resulting long-lived token.

  Token shape is validated (`sk-ant-oat01-…` prefix) so a mistyped token errors out at spawn time instead of writing a useless string. Rotate by editing the env file in place; the rc-source lines stay stable.

  `--claude-token` is visible to `ps`. Use `--claude-token-stdin` in scripts:

  ```
  echo "$CLAUDE_CODE_OAUTH_TOKEN" | apes agents spawn agent-x --claude-token-stdin
  ```

## 0.20.0

### Minor Changes

- [`6673c4b`](https://github.com/openape-ai/openape/commit/6673c4b718ad3c8f3c37734b6e41cb6fd53beeff) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - apes: `apes agents spawn` defaults to `/bin/zsh` (not ape-shell) + `exit` always succeeds in ape-shell

  Two related changes that backtrack from making ape-shell the default login shell for spawned agents:

  - **`apes agents spawn <name>` now defaults `--shell` to `/bin/zsh`** (macOS modern default) instead of `$(which ape-shell)`. Pass `--shell $(which ape-shell)` to opt the agent's macOS user into the grant-mediated REPL as login shell. Rationale: ape-shell intercepts every command through the grant flow, which trips on interactive niceties (terminal control sequences from Warp/iTerm, etc.) — bash/zsh as login shell with Claude's hook still routing Claude-issued commands through ape-shell is the safer default.
  - **`exit` (and `exit <code>`) in the ape-shell REPL always bypasses approval.** Getting OUT of the shell is a foot-gun if it requires a grant — agents and humans alike should be able to leave reliably even when the IdP is unreachable, the token has expired, or anything else has gone wrong.

  The `--no-claude-hook` flag is unchanged: the Claude bash-rewrite hook is still installed by default, so Claude-issued commands still go through the grant flow.

## 0.19.0

### Minor Changes

- [#220](https://github.com/openape-ai/openape/pull/220) [`23fa05b`](https://github.com/openape-ai/openape/commit/23fa05b5aea415330de60d622da1a61a7bb0ef17) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - apes/idp: `apes sessions list` and `apes sessions remove <id>` for self-service device management

  You can now see and revoke your own refresh-token families across devices without admin privileges:

  - `apes sessions list` — one row per `apes login` (one row per device), with familyId, clientId, createdAt, expiresAt
  - `apes sessions remove <familyId>` — revokes that specific family. The device using it fails its next token refresh with `Token family revoked` and has to `apes login` again

  Backed by two new IdP endpoints under `/api/me/sessions/…`:

  - `GET /api/me/sessions` — lists the caller's families (filtered to `userId = sub` from the authenticated session/JWT)
  - `DELETE /api/me/sessions/[familyId]` — ownership-checked: 404 if the family belongs to a different user, never 403, so users can't probe other users' familyIds

  The pre-existing admin endpoints at `/api/admin/sessions` (cross-user, requires admin role) stay as-is.

## 0.18.0

### Minor Changes

- [#219](https://github.com/openape-ai/openape/pull/219) [`32e7331`](https://github.com/openape-ai/openape/commit/32e733155ce15eed2fdf7d914279bf671ebb7fed) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - apes: auto-refresh expired tokens for every command (not just `ape-shell`)

  `ape-shell` has always rotated stale tokens transparently via the ed25519 challenge-response or OAuth refresh-token flow. The other `apes …` commands didn't — `apes whoami`, `apes grants list`, `apes agents list`, etc. either showed `EXPIRED` or threw `401 Not authenticated` even when a refresh path was available.

  The refresh now runs at CLI entry for every subcommand except the ones that genuinely shouldn't touch existing auth: `login`, `logout`, `init`, `enroll`, `register-user`, `dns-check`, `utils`, `explain`, `workflows`. Failure is silent — the actual command then surfaces a proper auth error if the token is genuinely unusable.

  Internally: extracted `ensureFreshToken()` from `apiFetch` and called it from `cli.ts` before `runMain(main)`.

## 0.17.0

### Minor Changes

- [#218](https://github.com/openape-ai/openape/pull/218) [`d8fb15c`](https://github.com/openape-ai/openape/commit/d8fb15cf3eeddd6d30f8f24ea7763a5347d87892) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - apes: `apes login <email>` accepts the email as a positional argument, and DDISA mismatches refuse to log in unless `--force` is passed

  Two UX improvements to `apes login`:

  - **Positional email**: `apes login patrick@hofmann.eco` now works directly. The legacy `--email` flag stays around as an alias.
  - **DDISA mismatch guard**: when an explicit `--idp` (or `APES_IDP` env, or `defaults.idp` in config.toml) selects a different IdP than the email's domain DDISA record points at, the login refuses with a clear diagnostic. Pass `--force` to bypass. This catches the foot-gun where `apes login --idp https://id.openape.at` produces a token that downstream SPs (e.g. `preview.openape.ai`, `chat.openape.ai`) reject with "IdP mismatch" because they trust the DDISA-resolved IdP instead. Auto-discovered IdPs (no explicit override) bypass the guard since by definition they can't mismatch.

## 0.16.0

### Minor Changes

- [`2a06d02`](https://github.com/openape-ai/openape/commit/2a06d02d39cc8c344cc2b740b104c1edb49c1c48) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - apes: new `apes utils …` namespace for admin/diagnostic tools, kicked off with `apes utils dig <domain|email>`

  `apes utils dig patrick@hofmann.eco` strips the local part, looks up the DDISA TXT record at `_ddisa.<domain>`, prints the parsed fields (issuer, mode, priority), and probes the resolved IdP via OIDC discovery. Same data as `apes dns-check` plus email-stripping and `--json` output. Future home for token decoders, config dumpers, version reporters that don't fit the grants/agents/auth namespaces.

  `apes dns-check` is unchanged for backward compatibility.

## 0.15.2

### Patch Changes

- [#198](https://github.com/openape-ai/openape/pull/198) [`0d33173`](https://github.com/openape-ai/openape/commit/0d33173c3db3ca9fb0bc78486042ef93857312c3) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - apes: `apes agents destroy` now uses `sysadminctl -deleteUser` and runs the IdP DELETE before the long-blocking `apes run --as root --wait`

  Two follow-up fixes to the v0.15.0 destroy flow surfaced during real-world use:

  - **`dscl . -delete` failed silently** and left orphaned macOS user records. The teardown script wrapped the call in `2>/dev/null || true` so a failure (Open Directory metadata still attached, etc.) was swallowed without trace — the home dir was `rm -rf`'d but `dscl . -read /Users/<n>` still returned a record afterwards. Now the script prefers `sysadminctl -deleteUser` (the canonical macOS API, which also removes Open Directory metadata), falls back to `dscl . -delete` only if `sysadminctl` is missing, propagates failures with a clear stderr message, and post-verifies the record is gone before printing `OK destroyed`.

  - **Token-expiry between the two destroy phases** stranded the IdP record when the approver took longer than the access-token TTL to approve the as=root grant. The IdP DELETE on `/api/my-agents/<id>` ran _after_ the long-blocking `apes run --as root --wait` call, so for PKCE-only logins (no refresh path) the parent token had already expired by then. Now the IdP DELETE/PATCH happens _before_ the escapes call — the token is fresh from preflight, the long approval wait happens after all IdP I/O is done. Idempotency is preserved: re-running destroy on a partially-cleaned agent skips the absent half cleanly.

## 0.15.1

### Patch Changes

- [#197](https://github.com/openape-ai/openape/pull/197) [`9a8f533`](https://github.com/openape-ai/openape/commit/9a8f533519fd008867acca7898f4d850338ac5f8) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - apes: `apes agents spawn` and `apes agents destroy` now `--wait` for the as=root grant approval

  Previously the inner `apes run --as root -- bash <script>` invocation returned exit code 75 (pending) immediately after creating the grant, before the user had a chance to approve it. spawn/destroy interpreted that as a hard failure and cleaned up the scratch directory in `finally`, so the pending grant ended up pointing at a `setup.sh` / `teardown.sh` that no longer existed on disk — the approval URL was useless.

  Both commands now pass `--wait` so the escapes call blocks until the grant is approved (or denied / times out) and the script has actually executed. Cleanup is safe because the grant has either run to completion or definitely won't run anymore.

## 0.15.0

### Minor Changes

- [`fea3cae`](https://github.com/openape-ai/openape/commit/fea3cae2185d2cbd763572bb9d7f9e85f0e9841f) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - apes: new `apes agents` namespace for managing owned agents end-to-end (`register`, `spawn`, `list`, `destroy`)

  Adds a four-command surface so spawning + tearing down ephemeral agents is no longer a hand-assembly job:

  - `apes agents register --name <n> --public-key '<line>'` — parent-authenticated `POST /api/enroll`. Returns the assigned agent email so a remote agent can `apes login` from its own machine using the matching private key. No keypair generation, no token issuance.
  - `apes agents spawn <n>` (macOS only) — provisions a local agent in one shot: generates an ed25519 keypair, registers it at the IdP, issues an agent access token, then runs a bash setup script under `apes run --as root` that creates a hidden macOS service user, places `~/.ssh/id_ed25519`, writes `~/.config/apes/auth.json`, sets `ape-shell` as login shell, and (unless `--no-claude-hook`) drops a Claude Code PreToolUse hook that rewrites every Bash tool call to `ape-shell -c '<cmd>'`. One DDISA approval per spawn, no `sudo` involved.
  - `apes agents list [--json] [--include-inactive]` — `GET /api/my-agents` with local `/Users` cross-reference so orphaned IdP agents (no OS user) show as `OS-USER ✗`.
  - `apes agents destroy <n> [--force] [--soft] [--keep-os-user]` — idempotent teardown. Hard-delete by default; `--soft` flips `isActive=false` instead; `--keep-os-user` skips the privileged escapes call so CI loops without an approver still work.

  End-to-end use:

  ```bash
  apes login patrick@hofmann.eco
  apes agents spawn agent-a
  apes run --as agent-a -- claude --session-name agent-a --dangerously-skip-permissions
  apes agents destroy agent-a --force
  ```

  Pre-flight (one-time per host): `ape-shell` must be in `/etc/shells`, `escapes` must be on PATH, and the parent must have an `as=root` authorization in their DDISA chain for spawn/destroy.

## 0.14.3

### Patch Changes

- Updated dependencies [[`eb0f82e`](https://github.com/openape-ai/openape/commit/eb0f82e357a11956c7545e50bdabbe46895a597d)]:
  - @openape/proxy@0.4.0

## 0.14.2

### Patch Changes

- [#192](https://github.com/openape-ai/openape/pull/192) [`fdd6b76`](https://github.com/openape-ai/openape/commit/fdd6b76efe1a14b688c903195f965fee328edff7) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - apes: `apes proxy --` no longer prints a misleading stack trace when the wrapped command exits non-zero

  Previously, after a wrapped command failed (e.g. `curl: (56) CONNECT tunnel
failed, response 403` on a denied grant), `apes proxy` printed a bare
  "ERROR" header followed by an internal stack trace ending in citty's
  `runMain` — even though the proxy itself worked correctly (it denied the
  request as policy required) and the wrapped command's exit code was the
  real signal.

  Cause: `proxy.ts` did `throw new CliExit(exitCode)` to propagate the wrapped
  exit code, intending the top-level handler in `cli.ts` to translate it into
  `process.exit(exitCode)`. But citty's `runMain` has its own try/catch that
  calls `consola.error(error, "\n")` before our handler ever runs. Combined
  with `CliExit`'s empty message, that surfaces as `ERROR\n  at Object.run …`.

  Fix: skip the CliExit hop and call `process.exit(exitCode)` directly from
  `proxy.ts` once cleanup has finished. The user sees only the wrapped
  command's stderr and gets the wrapped command's exit code — same outcome,
  no spurious "ERROR" framing on a working deny path.

## 0.14.1

### Patch Changes

- [#189](https://github.com/openape-ai/openape/pull/189) [`1bd0172`](https://github.com/openape-ai/openape/commit/1bd0172453a697ebca2ae18c0669b9a6a49360e6) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - proxy: drop local audit-log file, keep stderr-only summary

  The proxy used to append a JSONL audit record to a local file (default
  `~/.local/state/openape/proxy-audit.jsonl`, configurable via
  `proxy.audit_log`). Two problems with that:

  1. **It can't function as an audit trail.** Anything written on the agent's
     host is also writable by the agent — there's no integrity story we'd be
     willing to put in front of a reviewer. Local files are debugging data, not
     evidence.
  2. **It crashed the proxy on first use.** `appendFileSync` raised ENOENT
     because the default state dir didn't exist on a fresh machine, the
     exception bubbled out of `writeAudit`, tore down the in-flight CONNECT, and
     was misreported as `grant_timeout` by the surrounding `try/catch` of
     `handleConnect`.

  Both issues go away by removing the file path entirely. The stderr summary
  line stays — that's a debugging convenience for the operator running
  `apes proxy --` interactively, not an audit. The trustworthy audit record
  lives server-side on the IdP, recorded for every grant decision; a per-agent
  audit view will be exposed there in a follow-up.

  Removed surfaces:

  - `proxy.audit_log` config field (TOML) — silently ignored if still present in
    legacy configs; nothing reads it.
  - `initAudit()` export from `@openape/proxy` — now no-op semantics, function
    removed.
  - `apes proxy --` no longer emits `audit_log = …` into the auto-generated
    TOML.

  Drive-by: the stderr summary stopped printing `example.comexample.com:443`
  for CONNECT (`domain` and `path` were being concatenated, but CONNECT puts
  `host:port` in `path`).

- Updated dependencies [[`1bd0172`](https://github.com/openape-ai/openape/commit/1bd0172453a697ebca2ae18c0669b9a6a49360e6)]:
  - @openape/proxy@0.3.1

## 0.14.0

### Minor Changes

- [#186](https://github.com/openape-ai/openape/pull/186) [`9c1c38a`](https://github.com/openape-ai/openape/commit/9c1c38a57a0572512c9b6ba93fd047c5dc1df972) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - apes: `apes proxy --` is now IdP-mediated when the caller is logged in (M3)

  Closes the gap where the YOLO/Allow/Deny config on `id.openape.ai/agents/<email>`
  (Web tab) had no effect on `apes proxy --` invocations. Two reasons it
  previously didn't work:

  1. **The ephemeral proxy never asked the IdP.** Default config used
     `default_action="allow"` with no `[[grant_required]]` rule, so unmatched
     hosts went straight through. The IdP grant flow was unreachable.
  2. **Even if it had asked, the requester was synthetic.** The TOML hard-coded
     `agent_email = "ephemeral@apes-proxy.local"`, so YOLO lookups keyed on
     `(email, audience='ape-proxy')` couldn't match the user's real policy row.

  Both fixed:

  - `apes proxy --` now reads the cached `~/.config/apes/auth.json` (already
    populated by `apes login`). When found: `agent_email` becomes the user's
    real agent email, `idp_url` becomes the IdP they logged in against, and
    `default_action` flips to `"request"` — every unmatched egress triggers an
    IdP grant request whose pre-approval hook applies the user's YOLO policy.
  - Console banner now says which mode the proxy started in:
    `[apes proxy] IdP-mediated mode — agent=…, idp=…` vs
    `[apes proxy] not logged in — transparent mode`.

  Fallback for not-logged-in callers stays the M1a behavior (default-allow +
  audit, no IdP roundtrip) so `apes proxy --` doesn't suddenly fail for users
  who haven't run `apes login` yet — the warning tells them how to upgrade to
  mediated mode.

  End-to-end effect: on `id.openape.ai/agents/<email>` Web-tab, configuring
  "YOLO aus + allow-list `*.openai.com`" makes `apes proxy -- curl
https://api.openai.com/...` auto-approve, while `apes proxy -- curl
https://api.github.com/...` waits for human approval. Identical UX semantics
  to what the UI promises.

### Patch Changes

- [#188](https://github.com/openape-ai/openape/pull/188) [`21aa5fb`](https://github.com/openape-ai/openape/commit/21aa5fb6f7fc1f680f26cfa85c13f031e0f285b0) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - apes: `apes proxy --` requires `apes login` first

  Removes the silent fallback to transparent mode when no `~/.config/apes/auth.json`
  is present. That fallback shipped in the same minor that introduced
  IdP-mediation (M3) and was UX-dishonest: the UI on `id.openape.ai/agents/<email>`
  suggests YOLO + Allow/Deny rules apply, but a not-logged-in proxy ignored
  them all and just transparently let everything through. Worst kind of bug
  for a security-relevant feature — looks like it works, doesn't.

  Now `apes proxy --` exits with code **77** (EX_NOPERM) and a clear message:

  ```
  apes proxy requires `apes login` first.

  Without a login the proxy has no agent identity to attribute grant
  requests to, so the YOLO / Allow / Deny policy on id.openape.ai cannot
  apply. Run:

    apes login

  and re-run `apes proxy -- ...`.
  ```

  Tightening: anyone scripting around `apes proxy --` who relied on the silent
  transparent fallback now gets a hard fail. That's intentional — the security
  posture promised by the UI requires identity.

## 0.13.2

### Patch Changes

- Updated dependencies [[`63e6dd2`](https://github.com/openape-ai/openape/commit/63e6dd2ef98a1fd62a94b8565e5b5c6961279da2), [`cd3e7e6`](https://github.com/openape-ai/openape/commit/cd3e7e6cffbcc5861e8331227a745d87cd4b9db7)]:
  - @openape/proxy@0.3.0

## 0.13.1

### Patch Changes

- [#175](https://github.com/openape-ai/openape/pull/175) [`feda38f`](https://github.com/openape-ai/openape/commit/feda38fe056b823f6d673018c09d91d59eb581e1) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - apes: `apes proxy --` now sets all common proxy env-var variants

  Wider tool coverage for the env-var-based egress mediation. Previously
  only `HTTPS_PROXY`, `HTTP_PROXY`, and `NO_PROXY` (uppercase) were set.
  Now also: `https_proxy` / `http_proxy` / `no_proxy` (lowercase, libcurl

  - many Python tools), `ALL_PROXY` / `all_proxy` (curl, rsync, ftp), and
    `NODE_USE_ENV_PROXY=1` (Node 24+ native `fetch` via undici).

  Net effect: a wrapped command's child Node code (e.g. Claude Code's
  WebFetch tool calling out via undici) now routes through the proxy
  without per-app ProxyAgent wiring, and lowercase-only tools that
  previously bypassed (some Python `urllib`, older curl distro builds)
  are now covered.

  No CLI-flag change. Hard kernel-level enforcement (block direct
  sockets) remains a separate opt-in milestone.

## 0.13.0

### Minor Changes

- [`7b2a7a4`](https://github.com/openape-ai/openape/commit/7b2a7a4aa27173fa15e0fdde6c957059a50bca65) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - apes: new `apes proxy -- <cmd>` subcommand routes commands through the egress proxy

  ```bash
  apes proxy -- curl https://api.github.com/zen
  apes proxy -- gh repo list
  apes proxy -- bash -c 'curl https://...'
  ```

  The subcommand mirrors the orchestration shape of `apes run --root → escapes`:
  it is a thin wrapper that owns the _lifecycle_, not the policy. The actual
  allow/deny/grant-required rules live in `@openape/proxy` (a separate runnable),
  which is now spawned as a child process per invocation.

  Two lifecycle modes:

  1. **Ephemeral (default):** `apes proxy --` spawns a new `openape-proxy` child
     bound to a random free port on `127.0.0.1`, runs the wrapped command with
     `HTTPS_PROXY` / `HTTP_PROXY` pointing at it, kills the proxy on wrapped-
     command exit. Lifecycle = command lifecycle, like `time` or `op run`.
  2. **Reuse:** if `OPENAPE_PROXY_URL` is set in the environment, `apes proxy --`
     skips the spawn and points `HTTPS_PROXY` at the existing URL. This is the
     path that ape-shell will take in M1b: the user can run `openape-proxy &`
     themselves, `export OPENAPE_PROXY_URL=...`, and every subsequent
     `apes proxy --` reuses that long-lived daemon.

  Default config for the ephemeral spawn is permissive (`default_action = "allow"`)
  plus a small deny-list for cloud-metadata endpoints (AWS/GCP/Azure
  `169.254.169.254`, `metadata.google.internal`, `*.internal`). Per-user TOML
  overlay + harder defaults land in M2.

  `@openape/proxy` patch: the listen-callback now reads `server.address()` so
  the `Listening on http://...:<port>` line shows the actual bound port even
  when configured with `listen = "127.0.0.1:0"`. Used by `apes proxy --` to
  discover its child's port.

### Patch Changes

- [`6c13d24`](https://github.com/openape-ai/openape/commit/6c13d244354ac8ce5639923c806922d4c1b46b35) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - proxy + apes: Node-runnable build for `@openape/proxy`, depended on by `@openape/apes`

  `@openape/proxy` is now distributed as a Node-runnable bundle (`dist/index.js` with
  `#!/usr/bin/env node` shebang, exec bit set, target node22) instead of a Bun-only
  TypeScript source. The package's `bin` entry now points at `dist/index.js`, the
  package ships `dist/`, `config.example.toml`, and `README.md`.

  `@openape/apes` adds `@openape/proxy` as a `workspace:*` dependency. This is
  foundation work for the upcoming `apes proxy -- <cmd>` subcommand: a global
  `npm i -g @openape/apes` install will from now on also install the proxy
  binary, and `apes` can locate it via
  `require.resolve('@openape/proxy/package.json')` plus the `bin` field — no
  `bun` runtime required on the user's machine.

  No CLI behavior change today. `apes proxy --` lands in the next milestone.

- Updated dependencies [[`6c13d24`](https://github.com/openape-ai/openape/commit/6c13d244354ac8ce5639923c806922d4c1b46b35), [`7b2a7a4`](https://github.com/openape-ai/openape/commit/7b2a7a4aa27173fa15e0fdde6c957059a50bca65)]:
  - @openape/proxy@0.2.15

## 0.12.6

### Patch Changes

- [#167](https://github.com/openape-ai/openape/pull/167) [`5e6555b`](https://github.com/openape-ai/openape/commit/5e6555b2107ca539558fc39c09896854c4ff89ac) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - apes: switch from `node-pty` to `@lydell/node-pty` so install no longer requires Python or a C++ compiler

  Upstream `node-pty` ships prebuilt binaries only for darwin and win32. Linux users had to compile via `node-gyp`, which means Python + a working C++ toolchain on every install. `@lydell/node-pty` distributes per-platform binaries (`@lydell/node-pty-darwin-arm64`, `-darwin-x64`, `-linux-arm64`, `-linux-x64`, `-win32-arm64`, `-win32-x64`) via `optionalDependencies`, the same pattern as `esbuild`, `swc`, and `lightningcss`. npm/pnpm only resolves the matching platform's binary tarball; no install scripts, no compilation, no toolchain dependency.

  Side effects:

  - Removes the `postinstall` perm-fix hack (`scripts/fix-node-pty-perms.mjs`); the per-platform packages preserve the spawn-helper exec bit through pnpm 10's tarball extraction.
  - Removes `node-pty` from the root `pnpm.onlyBuiltDependencies` allowlist.

  No public API change. The PTY bridge keeps the same behavior (PS1-marker prompt detection, line-completion frames, exit-code capture).

## 0.12.5

### Patch Changes

- Updated dependencies [[`d7f78fa`](https://github.com/openape-ai/openape/commit/d7f78fa68478f295202351e15bfada8ce849c4db)]:
  - @openape/core@0.13.2
  - @openape/grants@0.11.2

## 0.12.4

### Patch Changes

- Updated dependencies [[`ed1ad3f`](https://github.com/openape-ai/openape/commit/ed1ad3f6cd7d8ed2c9309cabda503d3ecf6453ff)]:
  - @openape/core@0.13.1
  - @openape/grants@0.11.1

## 0.12.3

### Patch Changes

- Updated dependencies [[`d1c8f5a`](https://github.com/openape-ai/openape/commit/d1c8f5a711b088ac160c92d67a532f6f4d77d437)]:
  - @openape/grants@0.11.0

## 0.12.2

### Patch Changes

- Updated dependencies [[`d8e1516`](https://github.com/openape-ai/openape/commit/d8e15161d7edda67139633ec18c959a2cc8a57bd)]:
  - @openape/grants@0.10.0

## 0.12.1

### Patch Changes

- Updated dependencies [[`03edf70`](https://github.com/openape-ai/openape/commit/03edf70c9aa73a362cc3376d3a8f8e041620d054)]:
  - @openape/core@0.13.0
  - @openape/grants@0.9.0

## 0.12.0

### Minor Changes

- [#120](https://github.com/openape-ai/openape/pull/120) [`b7e9aea`](https://github.com/openape-ai/openape/commit/b7e9aea4a22f6cc601b3822039e3a2fc3aaac06e) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Add generic-fallback mode for `apes run -- <cli>` when the CLI has no
  registered shape.

  **Before:** `apes run -- kubectl get pods` hard-failed with
  `"No adapter found for kubectl"` unless a full `kubectl.toml` shape was
  written first.

  **After:** `apes run -- kubectl get pods` creates a synthetic adapter
  in-memory, requests a single-use grant with `risk=high` and
  `exact_command=true`, and runs the command once approved. An stderr
  warning makes the fallback explicit:

  ```
  ⚠ No shape registered for `kubectl`.
  Generic mode active — single-use grant will be required.
  ```

  **Safety layers:**

  - Forced `risk: "high"` on every generic grant
  - Forced `exact_command: true` — grant is bound to the exact argv hash
  - Single-use by default (enforced by IdP `usedAt` timestamp)
  - `~/.config/apes/generic-calls.log` captures every successful generic
    execution as JSONL for later shape promotion
  - Free-IdP approval page shows a prominent "⚠ Unshaped CLI" banner

  **Opt-out:** `[generic] enabled = false` in `~/.config/apes/config.toml`
  restores the legacy hard-fail behaviour.

  **Compatibility:**

  - Existing shapes are unaffected — generic-fallback only activates when
    `loadAdapter()` throws "No adapter found".
  - The synthetic path bypasses `resolveCommand()` entirely and feeds a
    pre-built `ResolvedCommand` into the grant pipeline. Parser remains
    unchanged.
  - The audit-log hook sits in `verifyAndExecute`, covering sync (`--wait`),
    async-default (`apes run` → `apes grants run <id> --wait`), and REPL
    one-shot paths with one implementation.
  - `apes run --as <user>` (escapes) and `ape-shell` one-shot session-grant
    behaviour are unchanged.

  **New public surface (`@openape/apes`):**

  - `shapes/generic.ts`: `buildGenericAdapter`, `buildGenericResolved`,
    `isGenericResolved`, `GENERIC_OPERATION_ID`
  - `shapes/adapters.ts`: `resolveGenericOrReject`
  - `audit/generic-log.ts`: `appendGenericCallLog`, `defaultGenericLogPath`
  - `config.ts`: `isGenericFallbackEnabled`, `getGenericAuditLogPath`,
    `ApesConfig.generic`

## 0.11.2

### Patch Changes

- [#112](https://github.com/openape-ai/openape/pull/112) [`c85ac2b`](https://github.com/openape-ai/openape/commit/c85ac2b41859d47b69c1678698da005c28c791f8) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Allow `apes run --as <user>` to self-dispatch from inside ape-shell.

  When an agent inside ape-shell runs `apes run --as root -- <cmd>`, the
  inner `apes` process has its own escapes-audience grant flow. Previously,
  the ape-shell grant layer treated all `apes run` invocations as gated
  and fell through to a generic session-grant that never reached escapes.
  Now `apes run --as` is recognized as a self-dispatch, so the inner
  process handles the escapes grant flow directly.

  `apes run` without `--as` remains gated as before.

## 0.11.1

### Patch Changes

- [#108](https://github.com/openape-ai/openape/pull/108) [`c18f707`](https://github.com/openape-ai/openape/commit/c18f707e3a02ca4ed2f0121844bd4513681ea638) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix the `sudo` guardrail regression in the `ape-shell -c "<cmd>"` one-shot
  path. 0.11.0 added the detection only to the interactive REPL
  (`shell/grant-dispatch.ts`), but agents using openclaw's `bash-tools.exec`
  with `SHELL=ape-shell` take the one-shot path through `runShellMode` in
  `commands/run.ts` — which fell through to the generic session-grant flow
  and surfaced an opaque "sudo: a password is required" error with no
  guidance.

  `checkSudoRejection` is now a shared helper in `shell/apes-self-dispatch.ts`
  used by both paths. `ape-shell -c "sudo chown root:wheel /tmp/x"` now
  throws a `CliError` with the same migration hint the REPL produces:

  > sudo is not available in ape-shell. Use `apes run --as root -- chown root:wheel /tmp/x` for privileged commands.

  Compound lines (e.g. `echo x | sudo tee ...`) still fall through to the
  generic session-grant path in both dispatch paths.

## 0.11.0

### Minor Changes

- [#106](https://github.com/openape-ai/openape/pull/106) [`9b5557e`](https://github.com/openape-ai/openape/commit/9b5557e3b2622ad5a4df1529f3ecf21a223d195a) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Align apes with the escapes naming and MIT-relicensed escapes repo:

  - `APES_IDP` is now the canonical env var for the IdP URL. `GRAPES_IDP`
    remains as a deprecated alias — it still works, but emits a warning.
    When both are set, `APES_IDP` wins.
  - OAuth `CLIENT_ID` used in the PKCE login flow is renamed from
    `grapes-cli` to `apes-cli`. `openape-free-idp` accepts any client id,
    so this is transparent there. Third-party IdPs with strict client
    allowlists need to register `apes-cli` (a transitional phase
    accepting both is recommended).
  - `ape-shell` now rejects bare `sudo <cmd>` lines with a clear hint
    pointing at `apes run --as root -- <cmd>`, which routes through the
    escapes setuid binary and requires a fresh grant per invocation.
    Compound lines still fall through to the generic session-grant path.

## 0.10.1

### Patch Changes

- [#104](https://github.com/openape-ai/openape/pull/104) [`180d26f`](https://github.com/openape-ai/openape/commit/180d26fd11cbf7bd39424236e0992d81d40a8b04) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - feat(apes): `apes grants run <id> --wait` + simplified agent text block

  Neuer `--wait` flag auf `apes grants run <id>` der CLI-seitig auf Approval wartet, plus refactored agent-mode text block der den neuen Flow empfiehlt. Schließt den letzten Gap aus dem 0.10.0 live-test: openclaw hat exit 75 + text korrekt gelesen, aber sein turn-based Execution-Modell konnte den "poll every 10s" Loop nicht durchhalten weil jede User-Nachricht den polling-turn unterbrochen hat.

  ## Das Problem

  Nach 0.10.0 hat openclaw den async-grant-Flow das erste Mal überhaupt **gelesen und befolgt**. Der strukturelle Attention-Anker (exit code 75 → `failed` tool-result status) hat gewirkt. Aber dann kam der zweite Layer:

  openclaw hat 2x gepollt, dann aufgehört. Ehrliche Selbst-Diagnose vom Agent:

  > _"Ich habe aufgehört zu pollen weil ich auf deine Nachricht reagiert habe statt stur weiterzupollen. Das war falsch — die Anweisung sagt 5 Minuten warten, egal was. Ich lerne es."_

  Der Grund ist architektonisch: **Chat-basierte Agents sind turn-based**. Ein Turn = ein Request/Response. Zwischen Turns gibt es keinen persistenten Background-Worker der Polling weiterlaufen lassen kann. Der 0.9.3/0.10.0 agent-text hat "poll every 10s for 5 minutes" verlangt, aber das setzt einen Persistent-Background-Worker voraus den Chat-Agents nicht haben.

  Jede neue User-Nachricht unterbricht den Agent, er reagiert auf die Nachricht statt zu pollen, der pending grant bleibt hängen.

  ## Der Fix — Polling-Orchestrierung von Agent-Seite auf CLI-Seite verlagern

  Patrick's Vorschlag war die richtige strukturelle Antwort: _"Inform User about the open Grant and retry with `apes grants run <id> --wait` until User approved."_

  Statt dass der Agent die Polling-Schleife selbst orchestriert, ruft er einmal `apes grants run <id> --wait` und die CLI blockiert intern bis approved/denied/timeout. Das passt zu **jedem** Execution-Modell:

  - **Chat-Agents (turn-based)**: ein einzelner Tool-Call der blockt, openclaw's `yieldMs` + `notifyOnExit` Mechanik resumed den Agent wenn das Kommando fertig ist
  - **Persistent-Background-Worker**: ein single call der bis zur Auflösung blockt, keine Loop-State-Machine nötig
  - **Script-Konsumenten**: ein single call, dann `$?` prüfen — der sauberste CI-Workflow

  Der Agent muss keinen Polling-Loop selber bauen, keinen Zustand zwischen Turns halten, und muss auch nicht mit "ich wurde durch User-Input unterbrochen" zurechtkommen.

  ## Die Implementation

  ### 1. Neuer shared Module `packages/apes/src/grant-poll.ts`

  Extrahiert die Poll-Config-Getter (`getPollIntervalSeconds`, `getPollMaxMinutes`) die bisher in `commands/run.ts` lokal definiert waren, plus einen neuen `pollGrantUntilResolved(idp, grantId)` Helper der das Polling macht:

  ```ts
  export type PollOutcome =
    | { kind: "approved" }
    | { kind: "terminal"; status: "denied" | "revoked" | "used" }
    | { kind: "timeout" };

  export async function pollGrantUntilResolved(
    idp: string,
    grantId: string
  ): Promise<PollOutcome> {
    const intervalMs = getPollIntervalSeconds() * 1000;
    const maxMs = getPollMaxMinutes() * 60_000;
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const grant = await apiFetch<{ status: string }>(
        `${grantsEndpoint}/${grantId}`
      );
      if (grant.status === "approved") return { kind: "approved" };
      if (
        grant.status === "denied" ||
        grant.status === "revoked" ||
        grant.status === "used"
      )
        return { kind: "terminal", status: grant.status };
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return { kind: "timeout" };
  }
  ```

  Single source of truth — beide Code-Pfade (`commands/run.ts` für die initiale Grant-Creation wait loops und `commands/grants/run.ts` für die CLI-side wait in `--wait` Mode) benutzen dieselben Knobs.

  ### 2. `commands/grants/run.ts` — neuer `--wait` flag

  ```ts
  args: {
    id: { type: 'positional', required: true },
    'escapes-path': { type: 'string', default: 'escapes' },
    wait: {
      type: 'boolean',
      description: 'If the grant is pending, block and poll until approved',
      default: false,
    },
  }
  ```

  Wenn status pending AND `args.wait === true`:

  ```ts
  if (grant.status === "pending") {
    if (!args.wait) {
      throw new CliError(`Grant ${grant.id} is still pending. Approve at: ...`);
    }
    const outcome = await pollGrantUntilResolved(idp, grant.id);
    if (outcome.kind === "timeout")
      throw new CliError(`... timed out after ${maxMin} minutes ...`);
    if (outcome.kind === "terminal")
      throw new CliError(`Grant ... resolved to ${outcome.status}`);
    // outcome.kind === 'approved' — re-fetch grant for up-to-date shape
    grant = await apiFetch<GrantDetail>(`${grantsUrl}/${args.id}`);
    consola.info(`Grant ${grant.id} approved — continuing`);
  }
  ```

  Wenn pending ohne `--wait`: bestehender Error wie bisher (regression guard).

  Nach dem pending-handler fällt der Flow in den bestehenden dispatch-Code durch — shapes grant → verifyAndExecute, escapes audience → escapes pipe, etc. Alle existierenden dispatch paths unverändert.

  ### 3. `commands/run.ts printPendingGrantInfo` — neuer agent-mode text

  Der "For agents:" Block wird komplett umformuliert von "poll every Xs" zu "call `apes grants run <id> --wait`":

  ```
  For agents:
    1. Tell the user about the pending grant and the approve URL above.
    2. Run `apes grants run <id> --wait`. This blocks up to 5 minutes
       until the user approves (or denies/timeout) and then executes
       the command in a single step. The CLI handles the polling loop
       internally — you do not need to poll the status yourself.
    3. Exit 0 means approved + executed; stdout is the command output.
       Exit 75 (pending) only appears if you accidentally call this
       without --wait. Any other non-zero exit means denied, revoked,
       used, or timeout — report the reason to the user.

  Note: exit code 75 (EX_TEMPFAIL) from this command means "pending,
  retry later" — do not abort your workflow, follow the steps above.
  ```

  Der Text ist jetzt execution-model-agnostisch — sowohl turn-based als auch persistent-background-Konsumenten können den single-call-Ansatz nahtlos ausführen. Plus der explizite Hinweis zu exit code 75 als "not an error" adressiert den edge case wo ein Agent-Framework den exit code als "task failed, abort" missinterpretiert.

  Das `APES_GRANT_POLL_INTERVAL` Knob ist jetzt ein **internes CLI-Detail** und wird nicht mehr im agent-text erwähnt — der Agent ruft einfach `--wait`, die CLI entscheidet wie sie pollt. Nur `APES_GRANT_POLL_MAX_MINUTES` bleibt im Text sichtbar weil es den User informiert wie lange er Zeit hat zu approven.

  ### 4. openclaw's yield-and-resume Mechanik als perfekter Fit

  Die Flow-Dynamik für openclaw wird:

  1. User: _"Führe `date` aus"_
  2. Agent ruft `ape-shell -c "date"` → exit 75 + grant info
  3. Agent liest "For agents: tell user + run `apes grants run xyz --wait`"
  4. Agent: _"Grant xyz erstellt. Bitte bestätigen: <url>. Ich warte bis approved."_
  5. Agent ruft `apes grants run xyz --wait` via exec tool
  6. openclaw's exec tool spawnt den child, wartet `yieldMs` (default 10s), yieldet zum Agent mit _"Command still running (session S)"_
  7. Agent endet seinen turn (z.B. _"warte noch auf approval, melde mich wenn's durch ist"_)
  8. Background-child pollt weiter mit `pollGrantUntilResolved`
  9. User approved im Browser
  10. Background-child sieht `approved`, fetcht token, führt `date` aus, schreibt Output nach session, exited 0
  11. openclaw's `notifyOnExit` fires → `requestHeartbeatNow({reason: "exec-event"})` → Agent wacht auf
  12. Agent liest session output, meldet `Tue Apr 14 21:11:38 CEST 2026`

  Das ist genau das Pattern das die Finding 5 "Silent-Agent-Block" aus dem ursprünglichen 0.8.0 plan addressed. Wenn openclaw's notifyOnExit funktioniert, terminiert der Flow ohne User-Nachstupsen. Wenn es nicht funktioniert, reicht ein User-Message als Re-Trigger (wie im aktuellen Screenshot-Fall).

  ## Test-Manifest

  ### Neue Tests in `commands-grants-run.test.ts` (7 Tests)

  1. **Regression guard**: ohne `--wait` bleibt pending → error Verhalten
  2. `--wait` + pending → poll → approved → dispatch shapes grant
  3. `--wait` + pending → poll → denied → CliError
  4. `--wait` + pending → poll → revoked → CliError
  5. `--wait` + pending → poll → timeout → CliError mit max minutes
  6. `--wait` + already-approved → dispatch sofort, kein poll
  7. `--wait` + pending → approved → escapes audience pipe

  ### Updated Tests in `commands-run-async.test.ts`

  8 existierende "async info block audience mode" Tests geupdated: die alten `expect(out).toContain('every 10s')` Assertions werden durch Assertions auf die neue Text-Struktur ersetzt (`For agents:`, `apes grants run X --wait`, `exit code 75`, `EX_TEMPFAIL`). Zusätzliche Regression-Guard: `APES_GRANT_POLL_INTERVAL` darf NICHT mehr in den agent-text leaken (da es jetzt internes CLI-Detail ist).

  ### Regression

  - `shell-grant-dispatch.test.ts`: 27/27 green (unberührt)
  - `commands-run-async.test.ts`: 43/43 green
  - `commands-grants-run.test.ts`: 15/15 green (8 baseline + 7 neu)
  - Full `@openape/apes` suite via turbo: **41 files / 495 green** (488 baseline aus 0.10.0 + 7 neu)

  ## Lineage

  `0.7.2 → 0.8.0 → 0.9.0 → 0.9.1 → 0.9.2 → 0.9.3 → 0.9.4 → 0.10.0 → 0.10.1`

## 0.10.0

### Minor Changes

- [#102](https://github.com/openape-ai/openape/pull/102) [`02551c3`](https://github.com/openape-ai/openape/commit/02551c3a52e75eb5672e9071e5189468916e02e1) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - **BREAKING**: `apes run` / `ape-shell -c` async-default exit code changes from `0` to `75` (`EX_TEMPFAIL`)

  When the async-default path creates a pending grant (i.e. no `--wait` or `APE_WAIT=1`), the process now exits with code **75** instead of 0. This is [`EX_TEMPFAIL` from `sysexits.h`](https://man.openbsd.org/sysexits.3) — semantically "temporary failure, try again later" — and is the same exit code `sendmail` and other mail-delivery tools have used for decades to signal "defer and retry" to their schedulers.

  ## Warum

  In 0.9.3 haben wir eine explizite Agent-Protokoll-Nachricht ("For agents: poll every 10s, wait up to 5 min, ...") in den async-Info-Block eingebaut um LLM-Agenten zu erklären was sie tun sollen. Beim Live-Test nach 0.9.4 stellte sich heraus dass openclaw's Agent die Nachricht **buchstäblich vor den Augen hatte und ignoriert hat**:

  > _"Das war direkt an mich als Agent adressiert — ich hätte es einfach befolgen müssen. Ich hab's schlicht ignoriert."_

  Untersuchung von openclaw's exec-runtime (`bash-tools.exec.ts`, `bash-tools.exec-runtime.ts`, `bash-process-registry.ts`) zeigte den strukturellen Grund: der Agent-Wrapper mapped **non-zero exit code → `failed` tool-result status**, und die "failed"-annotation ist ein viel stärkerer Aufmerksamkeits-Anker für den LLM als reiner Text-in-Stdout. Bei exit 0 sieht der Agent einen "success" tool-result mit einem ✓ Glyph, und trained-in behavior overridet alles was in der Nachricht selbst steht. Bei non-zero exit wird der Output als `failedTextResult` präsentiert, der LLM liest ihn aufmerksamer, und die Agent-Instruktionen werden befolgt.

  Das 0.9.3 text-first Design war korrekt aber **unzureichend ohne einen strukturellen Attention-Anker.** Der exit code IST der Anker. Das ist der fehlende zweite Kanal.

  ## Was sich ändert

  **Default:**

  ```bash
  $ apes run -- curl https://example.com
  ℹ Requesting grant for: Execute with elevated privileges: curl
  ✔ Grant <uuid> created (pending approval)
    Approve:   ...
    ...

  $ echo $?
  75
  ```

  Openclaw (und analoge Agent-Wrapper) sehen jetzt einen `failed`-annotierten tool-result mit allen bisherigen Output-Zeilen, inklusive dem expliziten "For agents: poll..." Block. Der Agent liest den Output aufmerksamer und folgt den Instruktionen.

  **Unverändert:**

  - `--wait` Flag / `APE_WAIT=1` → immer exit 0 on erfolgreichem Exec, wie bisher
  - Cache-Hits (`findExistingGrant` oder session-grant-reuse) → immer exit 0, command läuft sofort durch
  - Die self-dispatch shortcut für `apes <subcmd>` in ape-shell → immer exit 0 (weil direkt execShellCommand, kein pending grant)
  - Die rohen Output-Zeilen (`Approve:`, `Status:`, `Execute:`, agent/human Block) → **identisch**, nur der exit code ist anders

  Scripts die die Output-Zeilen via grep/sed extrahieren brechen nicht. Nur scripts die `$?` nach `apes run` checken — und die sollten entweder zu `--wait` wechseln (wenn sie synchrones Verhalten brauchen) oder den neuen exit code handhaben (wenn sie async OK sind).

  ## Override

  Der exit code ist dreistufig konfigurierbar, analog zu den anderen 0.9.3-Knobs (`APES_USER`, `APES_GRANT_POLL_INTERVAL`):

  ```bash
  # Env var (höchste Priorität)
  APES_ASYNC_EXIT_CODE=0    # restore pre-0.10.0 exit-0 behaviour
  APES_ASYNC_EXIT_CODE=2    # alternative: use shell usage-error convention
  APES_ASYNC_EXIT_CODE=7    # alternative: arbitrary distinctive code
  ```

  ```toml
  # ~/.config/apes/config.toml — fallback when env unset
  [defaults]
  async_exit_code = "0"
  ```

  Hierarchie: env wins → config fallback → default 75. Bogus values (non-numeric, negative, > 255) fallen zurück auf 75.

  Valid range ist POSIX exit code space (0–255).

  ## Warum 75 und nicht 1, 2, oder -1

  - **1** = POSIX "general error". Agenten und CI-Pipelines lesen das als "etwas ist schiefgegangen" ohne Spezifität. Falsches Signal — es ist kein Fehler, es ist ein erwarteter pending state.
  - **2** = lose Konvention für "shell usage error" oder "misuse of shell builtins" (bash, git). Würde als user's fault interpretiert. Auch falsch.
  - **-1** ist in POSIX nicht gültig — shells truncieren zu 255. Nicht portabel.
  - **126 / 127** sind reserviert für "command found but not executable" bzw. "command not found". Nicht passend.
  - **75** (`EX_TEMPFAIL`) hat über Jahrzehnte als Konvention für "defer and retry" in mail-delivery-tools gelebt. Dokumentiert in `sysexits.h` seit BSD-Zeiten, trainiert in LLMs via `man sysexits`, semantisch sehr nah an "pending grant, retry after approval". Best available fit.

  Alternative Kandidaten die auch sinnvoll gewesen wären: `73` (`EX_CANTCREAT`), `74` (`EX_IOERR`), `78` (`EX_CONFIG`). Alle schwächer gefittet als 75. Plus 75 hat die Bonus-Geschichte mit sendmail als retry-signal.

  ## Migration

  ### Für CI-Scripts die explizit `$?` prüfen

  ```bash
  # Vorher (implizit success assumption):
  apes run -- curl example.com && echo done

  # Option 1: explicit --wait
  apes run --wait -- curl example.com && echo done

  # Option 2: APE_WAIT env var
  APE_WAIT=1 apes run -- curl example.com && echo done

  # Option 3: expect the new exit code
  apes run -- curl example.com
  if [ $? -eq 75 ]; then echo "grant pending, need approval"; fi

  # Option 4: restore legacy behaviour explicitly
  APES_ASYNC_EXIT_CODE=0 apes run -- curl example.com
  ```

  ### Für AI-Agent frameworks

  Keine Migration nötig. Der neue exit code ist **exakt der Effekt den wir wollten**: tool-result wird als `failed` präsentiert, LLM liest den Output aufmerksamer, Agent folgt den "For agents:" Instruktionen. Falls ein Framework den exit code allerdings direkt als "task failed, abort the whole workflow" interpretiert (statt als "needs attention, read the output"), dann muss dort ein Custom-Handler hinzugefügt werden der 75 speziell als "pending, not an error" behandelt.

  ### Für Humans am Terminal

  Das `$?` nach einem `apes run` ist jetzt 75. Für die meisten interaktiven Workflows irrelevant — man liest den Output direkt und folgt der "Execute: apes grants run <id>" Zeile manuell. Wer den alten 0-Status zurück will:

  ```bash
  # .zshrc
  export APES_ASYNC_EXIT_CODE=0
  ```

  Oder in `~/.config/apes/config.toml`:

  ```toml
  [defaults]
  async_exit_code = "0"
  ```

  ## Test plan

  - [x] 11 new tests in `packages/apes/test/commands-run-async.test.ts` `async exit code (APES_ASYNC_EXIT_CODE)` describe block:
    - default 75 (EX_TEMPFAIL)
    - `APES_ASYNC_EXIT_CODE=0` restores legacy
    - `=2` custom override
    - `=255` POSIX maximum
    - `=256` (out of range) → fallback 75
    - `=-1` (negative) → fallback 75
    - `=not-a-number` → fallback 75
    - empty string → fallback 75
    - config.toml `defaults.async_exit_code` override when env unset
    - env wins over config
    - `--wait` mode unaffected (always exit 0 on successful exec)
  - [x] All existing 32 baseline tests updated to use new `expectCliExit(promise, 75)` helper for async-exit paths; `--wait` tests remain unchanged
  - [x] `shell-grant-dispatch.test.ts`: 27/27 green (0.9.2 REPL behavior untouched)
  - [x] Full `@openape/apes` suite via turbo: **41 files / 488 green** (477 baseline from 0.9.4 + 11 new)
  - [x] Pre-commit hook (turbo lint + typecheck): green

  ## Files touched

  - `packages/apes/src/commands/run.ts` — new `getAsyncExitCode()` helper, `throw new CliExit(getAsyncExitCode())` at all four async-exit sites (`runShellMode` session, `tryAdapterModeFromShell`, `runAdapterMode`, `runAudienceMode`)
  - `packages/apes/src/config.ts` — new `defaults.async_exit_code?: string` field in `ApesConfig` interface
  - `packages/apes/test/commands-run-async.test.ts` — new `expectCliExit` helper + 20 existing tests wrapped + 11 new exit code tests

  ## Lineage

  `0.7.2 → 0.8.0 → 0.9.0 → 0.9.1 → 0.9.2 → 0.9.3 → 0.9.4 → 0.10.0`

## 0.9.4

### Patch Changes

- [#100](https://github.com/openape-ai/openape/pull/100) [`58cf238`](https://github.com/openape-ai/openape/commit/58cf238475c8d41d308bf9f2ec6b431ec3fa12df) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - fix(apes): extend apes self-dispatch shortcut to `ape-shell -c` one-shot path + strip `APES_SHELL_WRAPPER` in `execShellCommand`

  Behebt einen Rekursions-Loop den openclaw's Polling-Flow exposed: `ape-shell -c "apes grants status <id> --json"` kreiert jetzt keinen eigenen Grant mehr. Der 0.9.2 self-dispatch shortcut (der `apes <subcmd>` aus der interaktiven REPL exempted) wird auf den one-shot Pfad erweitert, und als defense-in-depth wird `APES_SHELL_WRAPPER` in `execShellCommand` aus der bash-Env gestrippt.

  ## Das Problem

  Unter 0.9.2 kriegen Subcommands wie `apes grants run <id>` den self-dispatch shortcut im REPL (`shell/grant-dispatch.ts`) — sie bypassen den Grant-Flow weil sie als trusted shell-internal gelten. Aber der gleiche Check lebt **nicht** im one-shot Pfad (`commands/run.ts runShellMode`), den `ape-shell -c "<cmd>"` trifft nachdem `rewriteApeShellArgs` es zu `apes run --shell -- bash -c <cmd>` umschreibt.

  Für openclaw's Polling-Flow heißt das konkret:

  1. Openclaw spawnt `ape-shell -c "apes grants status <date-grant-id> --json"` als Child-Prozess
  2. Wird rewritten zu `apes run --shell -- bash -c "apes grants status <date-grant-id> --json"`
  3. `runShellMode` ruft `tryAdapterModeFromShell` — versucht den apes-Adapter zu laden
  4. Entweder wird ein shapes-Grant für die spezifische `apes grants status` Operation kreiert, oder der adapter-resolve failed und es fällt durch zum Session-Grant path mit command `['bash', '-c', 'apes grants status ...']`
  5. Openclaw sieht einen NEUEN Pending-Grant, wartet auf Approval
  6. User approved den → wait loop wacht auf → `execShellCommand(['bash', '-c', 'apes grants status ...'])`
  7. Bash spawnt `apes grants status ...` als Child, der aber `APES_SHELL_WRAPPER=1` aus dem inherited env sieht → `rewriteApeShellArgs` detected wrapper-mode → argv matched keine Regel → `action: 'error'` → "ape-shell: unsupported invocation" → exit 1
  8. Oder: openclaw pollt weiter und jedes Poll-Call kreiert einen neuen Grant. Turtles all the way down.

  Ergebnis: ein hängender Agent der mit jedem Poll-Call einen neuen Pending-Grant produziert und nie terminiert.

  ## Der Fix

  ### 1. Shared Module `packages/apes/src/shell/apes-self-dispatch.ts` (neu)

  Extrahiert `APES_GATED_SUBCOMMANDS` (nur `run`, `fetch`, `mcp`) und den `isApesSelfDispatch(parsed)` Helper als single source of truth. Beide Dispatch-Pfade importieren jetzt denselben Check.

  ### 2. `shell/grant-dispatch.ts`

  Ersetzt die inline-deklarierte Blocklist und den Check durch den Import + Helper-Call. Verhalten unverändert für die interaktive REPL — 27/27 bestehende `shell-grant-dispatch.test.ts` Tests bleiben grün.

  ### 3. `commands/run.ts runShellMode`

  Neuer early-return BEVOR `tryAdapterModeFromShell`:

  ```ts
  const innerLine = extractShellCommandString(command);
  if (innerLine) {
    const parsedInner = parseShellCommand(innerLine);
    if (isApesSelfDispatch(parsedInner)) {
      execShellCommand(command);
      return;
    }
  }
  ```

  Wenn `ape-shell -c "apes grants status <id>"` reinkommt, entpackt der Check den bash-c-wrapper, parst die innere Zeile, erkennt dass es ein trusted `apes` self-call ist, und ruft `execShellCommand` direkt — kein Grant, keine Wait-Loop, kein Info-Block.

  Das löst den Rekursions-Loop vollständig. Openclaw's Poll-Calls laufen jetzt durch als direct-exec ohne irgendeine Server-interaction.

  ### 4. `commands/run.ts execShellCommand` + `runAudienceMode` execFileSync

  Beide `execFileSync` Call-Sites in `commands/run.ts` strippen jetzt `APES_SHELL_WRAPPER` aus dem env den sie an bash bzw. escapes weitergeben:

  ```ts
  const { APES_SHELL_WRAPPER: _wrapperMarker, ...inheritedEnv } = process.env;
  execFileSync(command[0]!, command.slice(1), {
    stdio: "inherit",
    env: inheritedEnv,
  });
  ```

  Das spiegelt den Fix aus `pty-bridge.ts` (0.8.0 Finding 4) auf dem one-shot Pfad. Ohne diesen Strip würde ein nested `apes grants status` im bash-child die "unsupported invocation" Error kriegen, weil es seinen Parent's `APES_SHELL_WRAPPER=1` inheritet und sich selbst als ape-shell-mode detected.

  Defense in depth: selbst wenn jemand in Zukunft einen weiteren Call-Path einbaut der durch `execShellCommand` geht, bleibt der env-Strip als automatischer Schutz.

  ## Warum shared Module statt lokale Duplikation

  Code-Duplication wäre auch 10 Zeilen pro Seite gewesen — klein, aber mit einem echten Risiko: wenn jemand später `APES_GATED_SUBCOMMANDS` in einem der beiden Files editiert und vergisst den anderen zu updaten, läuft ein inkonsistentes Gating-Modell. Der shared Module macht die Regel explizit single-source-of-truth, und der bestehende Tripwire-Test in `shell-grant-dispatch.test.ts` (der behavioral die exakte gating-set überprüft) greift weiterhin.

  ## Test-Manifest

  **11 neue Tests** in `packages/apes/test/commands-run-async.test.ts` in zwei neuen describe-Blöcken:

  ### `runShellMode apes self-dispatch shortcut` (9 Tests)

  1. `apes grants status <id>` bypasses grant flow, execs directly
  2. `apes grants run <id>` bypasses (the bootstrap case)
  3. `apes whoami` bypasses
  4. `apes adapter install curl` bypasses
  5. `apes run -- echo hi` STAYS gated (run is in blocklist)
  6. `apes fetch https://example.com` STAYS gated
  7. `apes mcp server` STAYS gated
  8. `apes whoami | grep alice` (compound) does NOT self-dispatch
  9. `curl example.com` (non-apes) does NOT self-dispatch

  ### `execShellCommand APES_SHELL_WRAPPER env strip` (2 Tests)

  10. Strips `APES_SHELL_WRAPPER` from the bash child env when self-dispatching
  11. Strips `APES_SHELL_WRAPPER` from the escapes pipe in `runAudienceMode --wait` mode

  **Regression:**

  - `shell-grant-dispatch.test.ts`: **27/27 green** (0.9.2 baseline preserved via shared module)
  - `commands-run-async.test.ts`: **32/32 green** (21 baseline + 11 new)
  - Full `@openape/apes` suite via turbo: **41 files / 477 green** (466 baseline from 0.9.3 + 11 new)

  ## Lineage

  `0.7.2 → 0.8.0 → 0.9.0 → 0.9.1 → 0.9.2 → 0.9.3 → 0.9.4`

## 0.9.3

### Patch Changes

- [#98](https://github.com/openape-ai/openape/pull/98) [`676caba`](https://github.com/openape-ai/openape/commit/676cabaffe49a3d79864ec534badb8f93ef16188) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - feat(apes): agent-facing polling protocol in `apes run` async output + `APES_USER` mode switch

  Schließt einen echten UX-Gap der 0.9.0 async-default Releases: der Info-Block der beim Pending-Grant gedruckt wird, erzählt dem AI-Agent jetzt explicit was er als nächstes tun soll — poll-interval, max-wait, behavior bei approved / denied / timeout. Humans können via `APES_USER=human` auf einen kurzen freundlichen Block umschalten.

  ## Das Problem

  0.9.0's async default machte `apes run` / `ape-shell -c` non-blocking: nach Grant-Creation exit 0 mit Info-Text, User muss später `apes grants run <id>` rufen um tatsächlich auszuführen. Für Humans am Terminal war das klar; für AI-Agents (openclaw, Claude Code, ChatGPT) war's unsichtbar — der Agent sah die erfolgreiche `✔` Glyphe und exit 0 und meldete dem User "done", obwohl nichts passiert war. Es gab keine Instruktion im Output-Text, _was_ der Agent mit der Grant-ID machen soll, wie lange er polling soll, oder was bei Denial zu tun ist.

  ## Was neu ist

  ### 1. Agent-facing polling protocol

  Default-Output (wird gezeigt wenn `APES_USER` nicht auf `human` gesetzt ist):

  ```
  ✔ Grant e887a7e3-... created (pending approval)
    Approve:   https://id.openape.at/grant-approval?grant_id=e887a7e3-...
    Status:    apes grants status e887a7e3-... [--json]
    Execute:   apes grants run e887a7e3-...

    For agents: poll `apes grants status e887a7e3-... --json` every 10s, wait up to 5 minutes.
    When .status == "approved", run `apes grants run e887a7e3-...` to execute.
    On "denied" or "revoked", stop and report to the user.
    On timeout, stop and notify the user that approval has not happened.

    Tip: Approve as "timed" or "always" in the browser to let this
    grant be reused on subsequent invocations without re-approval.
  ```

  Der Agent bekommt konkrete imperative Instruktionen — poll, run, stop, report — und weiß wie die drei Terminal-States zu handlen sind (approved / denied|revoked / timeout). Per-agent Skill-Definitionen sind damit optional; jeder Agent in jedem Ökosystem bekommt dasselbe Verhalten ohne zusätzliche Konfiguration.

  ### 2. `APES_USER=human` für Humans

  Humans die regelmäßig mit `apes` arbeiten und den verbose Block nervig finden, setzen einmal `export APES_USER=human` in ihrer `.zshrc` und bekommen:

  ```
  ✔ Grant e887a7e3-... created — awaiting your approval
    Approve in browser:  https://id.openape.at/grant-approval?grant_id=e887a7e3-...
    Check status:        apes grants status e887a7e3-...
    Run after approval:  apes grants run e887a7e3-...

    Tip: Approve as "timed" or "always" in the browser to reuse
    this grant without re-approval on the next invocation.
  ```

  Kürzer, freundlicher, kein Agent-Polling-Block.

  ### 3. Konfigurierbares Poll-Interval + Max-Duration

  Die 10-Sekunden / 5-Minuten Defaults sind konfigurierbar via Env-Vars und `config.toml`:

  ```bash
  # Env vars (höchste Priorität)
  APES_GRANT_POLL_INTERVAL=30        # seconds between polls
  APES_GRANT_POLL_MAX_MINUTES=10     # max total wait
  ```

  ```toml
  # ~/.config/apes/config.toml (lower priority, fallback when env unset)
  [defaults]
  user = "agent"                       # or "human"
  grant_poll_interval_seconds = "30"
  grant_poll_max_minutes = "10"
  ```

  Env wins über config, config wins über baked-in defaults. Bogus values (non-numeric, negative) fallen gracefully zum Default. Die Zahlen fließen direkt in den Output-Text, damit der Agent immer die tatsächlich aktuelle Policy sieht — nicht eine hardcoded.

  ### 4. Default ist agent

  Die User-Mode Default-Wahl ist `agent`, nicht `human`. Rationale: Agenten sind die Zielgruppe bei der der Output-Text der einzige Kommunikationskanal ist. Humans können den verbose Block ignorieren — schlimmstenfalls lesen sie zwei extra Absätze. Agenten ohne explizite Instruktionen können den async-Flow gar nicht nutzen. Der konservative Default ist "zero-config für agents, one-line rc für humans".

  ## Konsistenz-Stabilität für Scripts

  Die drei Core-Label-Zeilen bleiben in beiden Modes enthalten und finden sich in jedem Output:

  - Die URL enthält immer `grant-approval?grant_id=<uuid>`
  - Die Status-Zeile enthält immer `apes grants status <uuid>`
  - Die Execute-Zeile enthält immer `apes grants run <uuid>`

  Existing Scripts die diese Strings via grep/sed extrahieren brechen nicht. Der Unterschied ist nur der Prosa-Block drumrum.

  ## Test-Manifest

  11 neue Tests in `packages/apes/test/commands-run-async.test.ts` im neuen `async info block audience mode` describe:

  1. Default (kein env, keine config): agent mode mit polling protocol
  2. `APES_USER=human`: short block, kein polling
  3. `APES_USER=agent`: wie default
  4. `APES_USER=invalid`: fällt zurück auf agent
  5. `config.toml defaults.user=human` überridet den agent default
  6. `APES_USER` env wins über `config.toml defaults.user`
  7. `APES_GRANT_POLL_INTERVAL=30` fließt in den agent text
  8. `APES_GRANT_POLL_MAX_MINUTES=10` fließt in den agent text
  9. config fallback für poll interval wenn env unset
  10. env wins über config für numeric knobs
  11. bogus env values (non-numeric, negative) werden ignored, defaults apply

  Plus: zusätzlicher Mock für `loadConfig()` im bestehenden `vi.mock('../src/config.js')` Setup, und Reset-auf-leere-config im `beforeEach` damit `mockReturnValue` aus einem Test nicht in den nächsten leakt.

  Full `@openape/apes` suite via turbo: 41 files, **466/466 green** (455 baseline aus 0.9.2 + 11 neu).

  ## Migration

  Keine. Ist ein pure-additive Output-Format-Change. Existing scripts die die Core-Label-Strings grep-en brechen nicht. Wer explicit den alten deutschen Text mit "erstellt" / "Ausführen" / "Tipp" parsed, bricht — aber das war 0.9.0 und wir sind nur 4 Patch-Releases später.

## 0.9.2

### Patch Changes

- [#96](https://github.com/openape-ai/openape/pull/96) [`8a85a02`](https://github.com/openape-ai/openape/commit/8a85a02568183e1e98174c566e566750489cb433) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - fix(apes): `apes <subcmd>` im REPL muss nicht mehr durch den Grant-Flow

  Der 0.9.0 async-default Grant-Flow hat einen Rekursions-Loop in der interaktiven `ape-shell` REPL aufgedeckt: `apes grants run <id>` selbst wurde durch `requestGrantForShellLine()` geschleust, der Shapes-Adapter für `apes` mapped den Call auf eine eigene Permission, und der REPL forderte einen _neuen_ Grant an (für die Erlaubnis, einen anderen Grant auszuführen). Approve-URL → exit 0 → user muss noch einen Grant approven → gleiches Spiel rekursiv. Der async-Flow wurde dadurch in der REPL effektiv unbenutzbar.

  ## Der Fix

  Ein früher `shell-internal` Dispatch-Pfad in `packages/apes/src/shell/grant-dispatch.ts`, der `apes <subcmd>` Invocations direkt approved, **bevor** der Adapter- oder Session-Grant-Pfad getriggert wird:

  ```ts
  if (parsed && !parsed.isCompound) {
    const invokedName = basename(parsed.executable);
    if (invokedName === "apes" || invokedName === "apes.js") {
      const subCommand = parsed.argv[0];
      if (subCommand && !APES_GATED_SUBCOMMANDS.has(subCommand)) {
        return { kind: "approved", grantId: "shell-internal", mode: "self" };
      }
    }
  }
  ```

  Der neue `mode: 'self'` auf `GrantLineResult` signalisiert Audit-Konsumern dass der Line als trusted REPL-intern executed wurde — kein Server-side Grant, keine Consume-Verification.

  ## Blocklist statt Whitelist

  Die Entscheidung über welche `apes` Subcommands gegated bleiben folgt einer **Blocklist**-Philosophie statt einer Whitelist:

  ```ts
  const APES_GATED_SUBCOMMANDS = new Set(["run", "fetch", "mcp"]);
  ```

  Nur drei Subcommands rechtfertigen shell-level Gating:

  - **`run`** — spawnt arbiträre Executables; das ist der Kernzweck des Grant-Systems.
  - **`fetch`** — forwarded den Bearer-Token an user-kontrollierte URLs; könnte Credentials exfiltrieren.
  - **`mcp`** — bindet einen Network-Port und serves eine persistente API.

  Alle anderen Subcommands (`whoami`, `health`, `grants list/run/status/approve/deny/revoke/token/delegate`, `config get/set`, `adapter install/list/show/uninstall`, `admin *`, `login`, `logout`, `enroll`, `init`, `register-user`, `explain`, `dns-check`, `workflows`) fallen automatisch in den `shell-internal` Pfad. Das sind alles entweder read-only Introspection, lokale Config-Mutationen im User-eigenen `$HOME`, oder IdP-Endpoints die bereits server-side durch den Auth-Token gescoped sind — Gating im Shell wäre redundant und macht nichts sicherer.

  ## Philosophie

  > _Inside the ape-shell REPL, `apes` is the trust root — not a user-authored external action._

  Wenn der User bereits authentifiziert ist und im REPL operiert, ist `apes whoami` kein zu-approvender Grant, sondern ein Shell-internaler Dispatch-Call, analog zu bash's `cd`, `export`, oder `alias`. Der Shell-Grant-Layer soll nur Dinge gaten die anderswo _nicht_ gated werden können — Code-Execution (`run`), Credential-Forwarding (`fetch`), persistente Services (`mcp`). Alles andere delegiert sich selbst an die darunterliegenden Auth-Layer (auth.json token, management token server-side, filesystem permissions).

  ## Bonus: `apes adapter install` ist jetzt konsistent mit dem Auto-Install-Pfad

  Vorher war `apes adapter install curl` aus der REPL heraus grant-gated, während `loadOrInstallAdapter('curl')` beim Auto-Triggered-Install (durch `apes run --shell -- bash -c 'curl ...'`) un-gated durchrauschte. Beides ist dieselbe Operation — ein Registry-Fetch + lokaler File-Write im User-Config-Dir. Jetzt sind beide Pfade konsistent exempt.

  ## Security-Implikationen

  Aufgegeben: shell-level Gating für `apes admin`, `apes register-user`, `apes enroll`. Diese Commands waren vorher via Grant-Flow gated, sind jetzt shell-internal.

  **Das ist sicher**, weil jeder dieser Commands server-side auth-gated ist:

  - `apes admin *` verlangt einen `management_token` in `config.toml`. Ohne Token → 401/403 vom IdP. Mit Token → User hat bereits out-of-band den Admin-Status zugewiesen bekommen; das shell-grant fügt keine zusätzliche Information hinzu.
  - `apes register-user` verlangt denselben `management_token`. Gleiche Logik.
  - `apes enroll` kreiert einen lokalen Ed25519-Keypair und hittet den public Enrollment-Endpoint. Der Enrollment-Endpoint verlangt Approval durch einen Admin — also auch server-side gated.

  Behalten: gating für die drei Subcommands die _nicht_ anderswo gegated sind.

  ## Tripwire

  Ein neuer Test `blocklist tripwire: APES_GATED_SUBCOMMANDS stays in sync with known apes subcommands` iteriert durch die bekannten 17 Top-Level-Subcommands aus `cli.ts` und verifiziert dass exakt `run`, `fetch`, `mcp` gegated werden und alle anderen self-dispatched. Wenn in einer zukünftigen Version ein neuer Subcommand addet wird, bricht dieser Test und zwingt im Code-Review die Klassifizierungs-Entscheidung: "ist das neue Ding `run`-like (spawner), `fetch`-like (credential forwarder), `mcp`-like (persistent server), oder fällt es ins default-trusted Lager?".

  ## Test-Bilanz

  12 neue Tests in `packages/apes/test/shell-grant-dispatch.test.ts`:

  - 7 self-dispatch tests: `apes whoami`, `apes grants run <id>`, `apes grants list`, `apes adapter install curl`, `apes admin users list`, `apes config set foo bar`, `apes health`
  - 3 still-gated tests: `apes run -- echo hello`, `apes fetch https://example.com`, `apes mcp server`
  - 1 compound regression guard: `apes whoami | grep alice` → gated via session path (compound short-circuits the self-dispatch)
  - 1 blocklist tripwire: iterates known subcommands, asserts exact gating set

## 0.9.1

### Patch Changes

- [#94](https://github.com/openape-ai/openape/pull/94) [`b0c55bd`](https://github.com/openape-ai/openape/commit/b0c55bdd9190df730b4c13a62ef078380a4e84ab) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - fix(apes): `apes grants status` zeigt wieder die richtigen Felder

  Drei pre-existing Display-Bugs in `apes grants status <id>`:

  1. **`Requester: undefined`** — das Kommando las `grant.requester`, aber die IdP-Response hat `requester` unter dem verschachtelten `request`-Objekt (`grant.request.requester`). Fix: lese aus der richtigen Stelle; wenn leer, wird die Zeile übersprungen statt `undefined` zu drucken.

  2. **`Owner: undefined`** — ein `owner`-Feld existiert überhaupt nicht auf dem `GET /grants/<id>` Endpoint. War ein Holdover aus einem früheren API-Shape. Komplett entfernt.

  3. **`Type: null`** — ein top-level `type`-Feld ist auf dem aktuellen IdP immer `null`. Die Zeile wird nicht mehr gedruckt.

  4. **`Decided at: 1776154298`** — Timestamps kamen als Unix-Sekunden (Zahl), wurden aber als Strings gedruckt (Rohzahl auf dem Terminal). Alle Zeitstempel (`created_at`, `decided_at`, `used_at`, `expires_at`) werden jetzt als ISO-8601 formatiert via `new Date(ts * 1000).toISOString()`.

  Als Bonus zeigt der Output jetzt zwei neue Felder die für den Debugging-Usecase nützlich sind und vorher fehlten:

  - **`Audience:`** — zeigt ob es ein `shapes` / `escapes` / `ape-shell` Grant ist (wichtig seit der Introduction des `apes grants run <id>` Subcommands in 0.9.0, der nach Audience dispatcht)
  - **`Host:`** — zeigt den `target_host`, wichtig für Session-Grants die host-gebunden sind

  Sowie:

  - **`Used at:`** — neu, zeigt wann ein once-Grant consumed wurde (nützlich um zu unterscheiden ob ein Grant `used` ist weil der User ihn ausgeführt hat oder weil er geblendet wurde)
  - **`Created:`** — neu, der Creation-Timestamp war vorher nicht sichtbar

  Keine Änderung an `apes grants status --json` — das dumped weiterhin die rohe API-Response unverändert.

## 0.9.0

### Minor Changes

- [#92](https://github.com/openape-ai/openape/pull/92) [`9ee98b7`](https://github.com/openape-ai/openape/commit/9ee98b72878a8bd86e8735b162904808e15091d1) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - feat(apes): `apes run` / `ape-shell -c` default auf async, neuer `apes grants run <id>` Subcommand

  **BREAKING CHANGE** — wer `apes run` oder `ape-shell -c "<cmd>"` heute scriptet und auf den Exit-Code des _tatsächlichen_ Kommandos verlässt, muss `--wait` oder `APE_WAIT=1` setzen.

  ## Warum

  Vor dieser Änderung blockierte jeder `apes run` / `ape-shell -c` Aufruf, der einen neuen Grant benötigte, bis zu 5 Minuten in einer 3s-Polling-Schleife, während der User auf dem Handy approven sollte. Für CI-Skripte war das OK, für interaktive Nutzer nervig und für AI-Agenten (openclaw, claude code, etc.) ein hartes Blocker-Pattern: der Agent stand still, bis der Mensch fertig war, und konnte nichts Anderes parallel erledigen.

  ## Was neu ist

  ### Default: async print-and-exit

  Wenn `apes run -- <cmd>` oder `ape-shell -c "<cmd>"` einen neuen Grant erzeugt, druckt der Command jetzt die Approve-URL und den Follow-up-Pfad und exitet sofort mit Code 0:

  ```
  $ apes run -- curl https://example.com
  ℹ Requesting grant for: Execute with elevated privileges: curl
  ✔ Grant 7b3a9e2c-... erstellt
    Approve:   https://id.openape.at/grant-approval?grant_id=7b3a9e2c-...
    Status:    apes grants status 7b3a9e2c-...
    Ausführen: apes grants run 7b3a9e2c-...

    Tipp: Im Browser "als timed/always approven" wählen, um das
    Kommando ohne erneuten Approval wiederzuverwenden.
  ```

  Der User approved im Browser, ruft dann `apes grants run 7b3a9e2c-...` und bekommt den tatsächlichen Command-Output.

  ### Cache-Hits unverändert

  Wenn bereits ein approved timed/always-Grant existiert (via `findExistingGrant` im Adapter-Pfad oder den Session-Grant-Lookup), führt die Erstinvocation direkt aus — kein Async-Zwischenschritt. Nur der Pending-Fall ändert sich.

  ### Neuer Subcommand: `apes grants run <id>`

  Führt einen approved Grant aus. Dispatcht nach Grant-Typ:

  - **Shapes-Grants**: lädt den Adapter lokal, re-resolved den `ResolvedCommand` gegen den recorded `execution_context.adapter_digest` (wirft bei mismatch), holt den Token via `fetchGrantToken`, und führt via `verifyAndExecute` aus.
  - **Escapes-Grants** (`audience === 'escapes'`): holt das `authz_jwt` und pipet an `escapes --grant <jwt> -- <cmd>`.
  - **Legacy `ape-shell` Session-Grants**: nicht re-executable — der Command gibt einen klaren Hinweis aus (session grants waren single-use gegen eine spezifische `bash -c` Zeile; der User soll stattdessen den Original-Aufruf wiederholen, der dann via `findExistingGrant` timed/always-Grants wiederverwendet).

  Status-Gates: `pending` → Hinweis + approve-URL, `denied`/`revoked` → Error, `used` → Error ("already been used — request a new one"), `approved` → dispatch.

  ### Override für Legacy-Workflows

  - **`apes run --wait`** / **`ape-shell -c --wait ...`** (CLI flag): erzwingt altes blockierendes Verhalten.
  - **`APE_WAIT=1`** (env var): gleiches Ergebnis aus der Umgebung heraus, für Fälle wo Flags nicht durchgereicht werden können (z.B. sshd-login-shell, cron, `$SHELL -c` aus einem Binary).

  Beide sind äquivalent und aktivieren denselben Legacy-Pfad in allen vier betroffenen Sub-Flows (`runShellMode` Session-Grant, `tryAdapterModeFromShell`, `runAdapterMode`, `runAudienceMode`).

  ### Interactive REPL bleibt unverändert

  Der `ape-shell`-REPL (ohne `-c`) hat seine eigene Verify-/Consume-Pipeline über `shell/orchestrator.ts` und ist von dieser Änderung nicht betroffen. Die REPL-Experience bleibt identisch zu 0.8.0 — blocking wait mit dem in 0.8.0 ergänzten `Grant <id> approved — continuing` Acknowledgment.

  ### Komposition mit #84

  Diese Änderung paart sich natürlich mit der in 0.8.0 gelandeten `APES_NOTIFY_PENDING_COMMAND` (PR #84): bei jedem Grant-Creation feuert sowohl der async Exit auf stdout als auch die konfigurierte out-of-band Notification (Telegram/osascript/beliebig). Der User merkt den Grant-Request auch wenn er gerade nicht aufs Terminal schaut.

  ## Migration

  Für CI-Skripte:

  ```bash
  # Vorher (implizit blocking):
  apes run -- curl https://example.com

  # Nachher (explizit blocking):
  apes run --wait -- curl https://example.com
  # oder
  APE_WAIT=1 apes run -- curl https://example.com
  ```

  Für sshd/cron-Workflows die `ape-shell` als Login-Shell fahren: `APE_WAIT=1` global in `.pam_environment`, systemd unit, oder direkt in der Cron-Expression setzen.

## 0.8.0

### Minor Changes

- [#84](https://github.com/openape-ai/openape/pull/84) [`366478f`](https://github.com/openape-ai/openape/commit/366478ffc75bbea77839e3a26ac1c1d018c8b087) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - feat(apes): configurable notification command when grant approval is pending

  When `ape-shell` (or `apes run --shell`) enters the grant approval wait loop, it now optionally runs a user-configured notification command so the user knows they need to approve. This is especially important when an AI agent (e.g., openclaw) spawns `ape-shell -c "<cmd>"` and the user is only reachable via Telegram, a TUI, or another out-of-band channel — previously the agent just silently blocked.

  **Only fires when actually waiting.** Reused timed/always grants that don't require new approval do NOT trigger a notification.

  Configuration via `~/.config/apes/config.toml`:

  ```toml
  [notifications]
  pending_command = "curl -sS 'https://api.telegram.org/bot$TOKEN/sendMessage' -d chat_id=$CHAT -d text='⏸ {command}\n{approve_url}'"
  ```

  Or per-invocation via env var (takes precedence):

  ```bash
  APES_NOTIFY_PENDING_COMMAND="osascript -e 'display notification \"{command}\" with title \"apes\"'" ape-shell -c "ls"
  ```

  Template variables: `{grant_id}`, `{command}`, `{approve_url}`, `{audience}`, `{host}`. All values are shell-escaped via `shell-quote` to prevent injection.

  The notification subprocess runs fire-and-forget (detached, unref'd, 10-second kill timeout) so it never blocks the grant flow.

- [#80](https://github.com/openape-ai/openape/pull/80) [`66214c3`](https://github.com/openape-ai/openape/commit/66214c333b0f45165237ef9d5a0962d2c6333a2e) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Support literal tokens in adapter positionals and remove the deprecated
  `@openape/shapes` package.

  The shapes adapter parser (`packages/apes/src/shapes/parser.ts`) now accepts
  positional names prefixed with `=` as literal matchers — the corresponding argv
  token must exactly equal the suffix and is not bound as a variable. This
  enables adapters for CLIs whose command shape interleaves fixed keywords with
  positional IDs, e.g.

  ```toml
  [[operation]]
  id = "task.archive"
  command = ["project"]
  positionals = ["project_id", "=workspace", "workspace_id", "=task", "task_id", "=archive"]
  ```

  matches `iurio project 42 workspace 7 task 123 archive` and binds
  `{project_id: '42', workspace_id: '7', task_id: '123'}`.

  The standalone `@openape/shapes` package has been removed from the monorepo.
  All shapes functionality has lived inside `@openape/apes` for some time and
  nothing inside the workspace imported `@openape/shapes` anymore. The
  `openape-free-idp` E2E test was ported to drive `apes run` instead of the
  retired `shapes request` CLI, and the `openape-shapes` SKILL moved from
  `packages/shapes/skills/` to `packages/apes/skills/`.

- [#90](https://github.com/openape-ai/openape/pull/90) [`8495c25`](https://github.com/openape-ai/openape/commit/8495c25785128d0e5c3b47792dbef2719eaeefd3) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - feat(apes): new `apes health` subcommand — external diagnostic probe

  A standalone read-only diagnostic that reports the current state of the CLI without entering the REPL or touching the pty layer. Designed to work even when the interactive shell is in a broken state.

  ```bash
  $ apes health
  apes 0.4.2

  Config: /Users/you/.config/apes
  Auth:   /Users/you/.config/apes/auth.json
          alice@example.com (human)
          IdP: https://id.openape.at
          Token: valid until 2026-05-14T14:25:31.000Z (local: 5/14/2026, 4:25:31 PM)

  IdP: reachable
  Grants: 12
  ape-shell: /usr/local/bin/ape-shell
  ```

  Reports:

  - `apes` binary version
  - Config dir and auth file locations
  - Auth identity, type (human/agent), IdP, token expiry (UTC + local)
  - IdP reachability (3s HEAD probe)
  - Grant count (best-effort — reported as unreachable if the API call fails, but does NOT fail the probe)
  - Resolved `ape-shell` binary path

  Exit codes: `0` if auth is valid AND IdP is reachable; `1` otherwise (not logged in, token expired, or IdP unreachable). A failed grants lookup alone does not fail the probe.

  `--json` emits the full report as machine-readable JSON with an `ok` field for single-check consumption.

- [#91](https://github.com/openape-ai/openape/pull/91) [`2584aac`](https://github.com/openape-ai/openape/commit/2584aacd62f861ccd4eb9e367a37f0f35757a569) Thanks [@alice@example.com](https://github.com/alice@example.com)! - feat(apes): REPL meta-commands (`:help`, `:status`, `:reset`)

  The `ape-shell` interactive REPL now recognizes three meta-commands that are dispatched before the grant flow and the bash pty. They only fire from an empty input buffer (never mid-multiline) and can never be confused with shell commands that happen to start with a colon.

  ### `:help`

  Lists available meta-commands with one-line descriptions.

  ### `:status`

  Prints the current session state — session id, uptime, host, bash child pid, requester identity, IdP URL, and token validity. Auth is re-read at invocation time so external token refreshes are visible immediately. Supports expired and not-logged-in states without throwing.

  ```
  Session: 3f7a9e2c1b8d4f05 (uptime 12m 34s)
  Host:    lappy.local
  Bash:    pid 54321

  IdP:     https://id.openape.at
  Token:   valid until 2026-05-14T14:25:31.000Z
  ```

  ### `:reset`

  Kills the current bash pty child and spawns a fresh one. This is the recovery lever when bash gets into a weird state (stuck subshell, leftover environment, unexpected prompt). The session audit log is **preserved** (same session id, continuous event stream) so `:reset` does not look like a new shell to downstream consumers. Grants do not need resetting — they are re-fetched server-side on every line anyway.

  `:reset` refuses while a command is in flight (`Cannot reset while a command is running. Wait or press Ctrl-C.`) to avoid orphaning an in-flight promise.

  Together with `apes health` (shipped alongside), these give the user observability into and recovery from the grant-gated shell without having to exit and restart.

### Patch Changes

- [#89](https://github.com/openape-ai/openape/pull/89) [`b924c30`](https://github.com/openape-ai/openape/commit/b924c30530accfe88c0cc01d5354e418cc5f1daa) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - fix(apes): grant-shell UX — visible cache/approval state and `apes` subcommand routing from the REPL

  Three related fixes that make the ape-shell grant flow observable and self-consistent.

  1. **`apes <subcommand>` inside the interactive REPL no longer errors with "unsupported invocation".** Root cause was that the `ape-shell` wrapper script exports `APES_SHELL_WRAPPER=1` into its node process env so `rewriteApeShellArgs` can detect wrapper invocation — but that env var was then leaked, unfiltered, into the bash pty child spawned by `PtyBridge`. Any `apes` subcommand the user typed inside that bash re-read the var from its inherited env, self-detected as ape-shell mode, and rejected its argv. `PtyBridge` now strips `APES_SHELL_WRAPPER` from the env it passes to `pty.spawn`.

  2. **Grant cache hits now emit a visible reuse line**, so the user can tell that a command was allowed because a pre-approved grant was reused rather than because the gating layer was bypassed. Both the adapter-grant path (which already logged a reuse line) and the session-grant path (which was silent) now print `Reusing ...`. Both lines can be suppressed by exporting `APES_QUIET_GRANT_REUSE=1` for power users who want a clean stream.

  3. **Pending grants now emit an approval acknowledgment line** when the wait loop resolves as approved. Previously the wait loop returned silently — the user only saw the command's output and could not distinguish a live approval round-trip from an instant cache hit. Both the adapter wait path (using `waitForGrantStatus`) and the session-grant inline polling loop now print `Grant <id> approved — continuing` before returning.

  Together these make it possible to watch the grant state from inside the interactive shell without leaving it: cache hits are visible, approval round-trips are visible, and `apes grants list` / `apes whoami` work again from the REPL prompt.

## 0.7.2

### Patch Changes

- [#78](https://github.com/openape-ai/openape/pull/78) [`05d46e2`](https://github.com/openape-ai/openape/commit/05d46e2573c3676744ec63bb67b1aa622d32156f) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Ship `scripts/` directory in the published npm package so the `postinstall`
  script `scripts/fix-node-pty-perms.mjs` actually exists after `npm install -g`.
  Previously the `files` field only included `dist` and `README.md`, which made
  global install fail with `Cannot find module fix-node-pty-perms.mjs`.

## 0.7.1

### Patch Changes

- [#76](https://github.com/openape-ai/openape/pull/76) [`716c90e`](https://github.com/openape-ai/openape/commit/716c90ee7de58ba1a18cb53dfe6a007ff265c792) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - fix(apes): suppress pty input echo in interactive ape-shell REPL

  The persistent bash child runs inside a pty whose default line discipline
  echoes input back in canonical mode. Combined with the ape-shell readline
  frontend (which already renders `apes$ <line>`), this caused every command
  to appear twice in the user's terminal:

  ```
  apes$ whoami            ← readline echo (frontend)
  ℹ Requesting grant for: …
  whoami                  ← pty line-discipline echo (redundant)
  openclaw                ← actual output
  apes$
  ```

  Fix: prepend `stty -echo 2>/dev/null` to `PROMPT_COMMAND` so the pty's
  input echo is disabled before every prompt, matching the single-echo
  behavior of a regular interactive shell. Runs after every prompt so it
  also re-applies if a user command toggles echo. Interactive TUI apps
  (vim, less, top) set their own termios when they start and are
  unaffected.

## 0.7.0

### Minor Changes

- [#50](https://github.com/openape-ai/openape/pull/50) [`68c6998`](https://github.com/openape-ai/openape/commit/68c69987122e05d396db3431d5ff3993b71db5b9) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - feat(apes): smart defaults for `apes login`

  `apes login` now auto-detects all three inputs via a fallback cascade (flag → env → config → derivation):

  - **Key:** defaults to `~/.ssh/id_ed25519` when present
  - **Email:** extracted from `<key>.pub` comment (set via `ssh-keygen -C <email>`) when the comment contains `@`
  - **IdP:** discovered via DDISA DNS (`_ddisa.<email-domain>`) using `resolveDDISA` from `@openape/core`

  Happy path becomes:

  ```
  apes login
  ```

  A new `--browser` flag forces the PKCE/browser login even when an SSH key is available. Explicit flags, `APES_KEY`/`APES_EMAIL`/`APES_IDP` env vars, and `~/.config/apes/config.toml` still take precedence over derivation.

- [#69](https://github.com/openape-ai/openape/pull/69) [`1f790f4`](https://github.com/openape-ai/openape/commit/1f790f4ffb638176341f1eaef2240fc6e1227f11) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - feat(apes): grant flow integration for the interactive REPL (M4 of ape-shell interactive mode)

  Every line a user types in `ape-shell` is now gated through the apes grant flow **before** it reaches the persistent bash pty. Adapter-backed commands (single-token, matching a shapes adapter) get a structured grant with resource chain and permission. Compound commands, commands without an adapter, or lines where adapter resolution fails fall back to a generic `ape-shell` session grant. Existing timed/always session grants for the same target host are reused.

  Refactors `verifyAndExecute` in `packages/apes/src/shapes/grants.ts` into three exported pieces:

  - `verifyAndConsume(token, resolved)` — verifies the JWT, checks authorization details against the resolved command, and marks the grant as consumed on the IdP. Does NOT execute anything.
  - `executeResolvedViaExec(resolved)` — runs the resolved command via `execFileSync` with inherited stdio (the legacy one-shot path).
  - `verifyAndExecute(token, resolved)` — preserved as before; composes the two above.

  The interactive REPL calls `verifyAndConsume` and then writes the original line to bash's pty, so execution happens inside the REPL's persistent shell state instead of a fresh child. The one-shot `apes run --shell` path keeps using `verifyAndExecute` and is unchanged.

- [#68](https://github.com/openape-ai/openape/pull/68) [`7743247`](https://github.com/openape-ai/openape/commit/77432478d0f86e769a4d0bf34146a8d578449b57) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - feat(apes): wire interactive REPL to persistent bash child (M3 of ape-shell interactive mode)

  Adds `runInteractiveShell` — the orchestrator that glues the M2 `ShellRepl` to the M1 `PtyBridge`. Each accepted line is now written to a real bash pty, output streams back live to the user's terminal, and the REPL waits for the prompt marker before accepting the next line. Raw-mode stdin forwarding makes interactive TUI apps (`vim`, `less`, `top`) work inside the session. SIGWINCH is forwarded to the pty so TUI apps re-render correctly on terminal resize.

  State (cwd, environment variables, aliases, functions) persists across lines because a single bash process stays alive for the whole session. An integration test suite (`shell-orchestrator.test.ts`) exercises the full flow against a real bash child: simple commands, sequential state persistence, environment variable persistence, multi-line for-loops, and an assertion that the prompt marker never leaks into visible output.

  No grant flow yet — every line executes unconditionally. That arrives in M4.

- [#63](https://github.com/openape-ai/openape/pull/63) [`7e54b18`](https://github.com/openape-ai/openape/commit/7e54b18b0fcfa2e43c910cce6d572956d084d69f) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - feat(apes): add PtyBridge — pty wrapper around a persistent bash child

  First milestone (M1) of the interactive `ape-shell` REPL feature (#62).

  `PtyBridge` spawns a persistent bash child via `node-pty` with a random-hex marker embedded in `PROMPT_COMMAND` + `PS1`. It detects marker occurrences in the output stream, strips them before they reach the consumer, and fires `onLineDone` with the accumulated output + exit code once bash has finished each command.

  Full shell state (cwd, environment variables, aliases, functions) persists across calls because a single bash process stays alive between commands.

  This lands as internal infrastructure only — no user-visible command or REPL loop is wired up yet. That follows in later milestones.

- [#65](https://github.com/openape-ai/openape/pull/65) [`fd955a2`](https://github.com/openape-ai/openape/commit/fd955a2a6338026fcc34342ab1bb74b5b65091fe) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - feat(apes): interactive REPL loop + multi-line detection (M2 of ape-shell interactive mode)

  `ape-shell` now detects when it is invoked without `-c` and hands control to an interactive REPL instead of erroring out. The REPL uses Node's `readline` with history, a custom `apes$ ` prompt, and multi-line accumulation driven by a `bash -n` dry-parse plus a dedicated heredoc detector (bash's `-n` mode accepts unterminated heredocs, which the REPL cannot).

  Invocation mode detection is strictly backward-compatible: `ape-shell -c "<cmd>"` still rewrites to the existing one-shot path, so `SHELL=$(which ape-shell) <program>` patterns (openclaw tui, xargs, git hooks, sshd non-interactive) do not regress. New triggers that enter the REPL: no args, `-i`, `-l`/`--login`, or a login-shell convention dash prefix (`-ape-shell` as used by sshd/login/su).

  This milestone lands the input state machine only — there is no grant dispatch or bash execution yet. Each complete line is handled by a pluggable `onLine` callback; the built-in stub logs it via consola. Grant dispatch and pty execution arrive in the next milestones.

- [#70](https://github.com/openape-ai/openape/pull/70) [`880df9f`](https://github.com/openape-ai/openape/commit/880df9f7ea5034e145a498ec203f6c99d32783dc) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - feat(apes): audit logging for interactive shell sessions (M5 of ape-shell interactive mode)

  Every interactive `ape-shell` session is now recorded in `~/.config/apes/audit.jsonl` with the following event types:

  - `shell-session-start` — session id (16 random hex chars), host, requester email
  - `shell-session-line` — per line: seq number, literal line, grant id, grant mode (adapter/session), status (executing/denied)
  - `shell-session-line-done` — per completed line: seq number, exit code
  - `shell-session-end` — duration, total line count

  Denied lines are logged too, which gives you an auditable record of every attempted command in a session — whether it was executed or rejected by the grant flow.

### Patch Changes

- [#57](https://github.com/openape-ai/openape/pull/57) [`da8f875`](https://github.com/openape-ai/openape/commit/da8f8758e7af6b04ca58436a3b1d86255ee4b71f) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - fix(apes): adapter lookup normalizes absolute paths and matches on executable

  `ape-shell` / `apes run --shell` previously failed to resolve a shapes adapter when the parsed command started with an absolute path (`/usr/local/bin/o365-cli`) or when the registry entry's `id` differed from its `executable` field. Both cases fell back silently to a generic `bash -c` session grant.

  - `loadOrInstallAdapter` now normalizes the input with `basename()` before any lookup.
  - `findAdapter` matches both `id` and `executable`, so a binary name like `o365-cli` resolves to its registry entry (`id: "o365"`). Backward compatible — `id`-based lookups keep working.
  - After auto-install, the adapter is reloaded under the registry `id`, not the executable name.

- [#52](https://github.com/openape-ai/openape/pull/52) [`9982f30`](https://github.com/openape-ai/openape/commit/9982f300f062968956a808c90e0cd83adad2c361) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - fix(apes): clearer error when `apes login` cannot discover an IdP

  When the DDISA DNS lookup fails and no `--idp` / `APES_IDP` / config default is set, the error now lists three concrete options with self-hosting as the recommended path and OpenApe's hosted IdP as an opt-in testing fallback.

- [#55](https://github.com/openape-ai/openape/pull/55) [`a53d577`](https://github.com/openape-ai/openape/commit/a53d577215a6df811aa8655689ae3d86f63d6a66) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - fix(apes): always print auth URL in `apes login --browser`

  The PKCE browser flow now always prints the authorization URL to stdout so users can copy/paste it manually when a browser cannot be opened automatically — SSH sessions, containers, CI runners, or restricted-user shells (e.g. `su - <user>` on macOS). Opening the browser via `open`/`xdg-open`/`start` remains a best-effort convenience.

- [#59](https://github.com/openape-ai/openape/pull/59) [`f357197`](https://github.com/openape-ai/openape/commit/f3571973774c58d9b4b1eccc70169d62e9f01fda) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - fix(apes): normalize basename before resolveCommand in ape-shell routing

  Follow-up to the previous adapter-lookup fix. `tryAdapterModeFromShell` in `apes run --shell` still passed the raw first token from the parsed shell command into `resolveCommand`, which does a strict comparison against `adapter.cli.executable`. Commands that started with an absolute path like `/usr/local/bin/o365-cli` loaded the adapter correctly but then threw inside `resolveCommand`, and the error was swallowed into `consola.debug` — silently falling back to a generic `bash -c` session grant.

  The call site now normalizes `parsed.executable` via `basename()` before passing it into `resolveCommand`. `resolveCommand` itself stays strict.

- [#75](https://github.com/openape-ai/openape/pull/75) [`5779de8`](https://github.com/openape-ai/openape/commit/5779de85fb514a0311564c40a9b259024d7f2bea) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Transparent session auto-refresh — no more hourly `apes login`.

  - `apes login --key <path>` now persists the resolved absolute key path and agent email
    to `~/.config/apes/config.toml` so every subsequent `apes` / `ape-shell` invocation
    can auto-refresh its access token via Ed25519 challenge-response, without the user
    needing to edit the config file manually. Auto-refresh is enabled as a one-time setup,
    not a recurring ritual.
  - New OAuth2 refresh_token flow in `apiFetch()` for PKCE/browser-login users: when the
    access token is expired and a `refresh_token` is stored in `auth.json`, the client
    now calls `/token` with `grant_type=refresh_token` and rotates both the access token
    and the refresh token. Concurrent refreshes are serialized via a POSIX file lock
    (`~/.config/apes/auth.json.lock`) with stale-lock eviction, so parallel `ape-shell`
    invocations don't race each other into a rotating-family revoke.
  - Refresh priority: Ed25519 agent key > OAuth refresh_token > "Run `apes login` first".
    Agent-key first because each challenge is independent server-side and therefore
    concurrency-safe.
  - `apes logout` now also wipes the `[agent]` section from `config.toml`, keeping
    `[defaults]` so the IdP URL survives.
  - Server-side 400/401 responses to `/token` clear the stored `refresh_token` so a
    revoked family doesn't trigger an infinite retry loop.
  - 13 new unit + integration tests cover the refresh priority chain, family-revoke
    handling, file-lock serialization, stale-lock eviction, config.toml merge, and
    logout wipe.

- [#71](https://github.com/openape-ai/openape/pull/71) [`d83228d`](https://github.com/openape-ai/openape/commit/d83228d6c43b3e67d72a98f0624667e902f9f6d8) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - docs(apes): document login-shell installation for interactive `ape-shell` + add non-regression integration tests

  Expands `packages/apes/README.md` with the interactive REPL workflow, the login-shell install recipe (`/etc/shells` + `chsh`), and explicit documentation that the one-shot `ape-shell -c "<cmd>"` path continues to work unchanged under `SHELL=$(which ape-shell)`.

  Adds `packages/apes/test/shell-login-integration.test.ts` — a spawned-subprocess test that builds the CLI, symlinks it as `ape-shell` in a tmp dir, and asserts:

  1. `ape-shell -c "echo hello"` reaches the one-shot rewrite path and exits (no REPL loop, no hang)
  2. `ape-shell --version` prints a versioned banner
  3. `SHELL=<path-to-ape-shell> bash -c "…"` still works as a non-regression smoke check

- [#73](https://github.com/openape-ai/openape/pull/73) [`86c41ce`](https://github.com/openape-ai/openape/commit/86c41ce125ba944f7c7f2eecb908adc19b7bff9b) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - fix(apes): login-shell wrapper script for environments without node on PATH

  When `ape-shell` is set as a user's login shell via `chsh`, the kernel invokes it **before** any rc file has run. The CLI's `#!/usr/bin/env node` shebang then fails with `env: node: No such file or directory` in environments where node lives in an nvm path that is only added to `PATH` by `.bashrc`/`.zshrc`.

  Fixes:

  - New `packages/apes/scripts/ape-shell-wrapper.sh` bash wrapper that hoists Homebrew / `/usr/local/bin` / nvm onto `PATH` before exec-ing node with the real `cli.js`. Uses `exec -a "$0"` to preserve the original argv[0] (including the leading dash login/sshd prepend to signal "login shell") so interactive-mode detection still works.
  - `rewriteApeShellArgs` now also accepts an optional `argv0` second parameter and honors `process.env.APES_SHELL_WRAPPER=1` as a detection signal. When either is set, invocation is recognized as ape-shell even though `argv[1]` is now the path to `cli.js` (not literal `ape-shell`).
  - `cli.ts` passes `process.argv0` through so the wrapper path sees login-shell dash detection correctly.

  Install:

  ```bash
  sudo ln -sf /path/to/packages/apes/scripts/ape-shell-wrapper.sh /usr/local/bin/ape-shell
  echo /usr/local/bin/ape-shell | sudo tee -a /etc/shells
  sudo chsh -s /usr/local/bin/ape-shell openclaw
  ```

  Backward compat: direct invocations with `argv[1]` basename matching `ape-shell` still work exactly as before, so existing symlink setups keep functioning without any env var.

- [#72](https://github.com/openape-ai/openape/pull/72) [`13d68b2`](https://github.com/openape-ai/openape/commit/13d68b298a855df201987dd09c8722a6ffd17f97) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - fix(apes): E2E polish for interactive shell lifecycle (M7 of ape-shell interactive mode)

  Final polish of the interactive `ape-shell` REPL:

  - **Clean shutdown on SIGTERM / SIGHUP** — `gracefulShutdown` handler kills the bash child, closes the audit session, restores the terminal out of raw mode, and stops the REPL in one idempotent sweep. Previously a kill signal could leave the terminal in raw mode.
  - **Emergency TTY restore** — `process.on('exit', …)` handler restores stdin's raw mode flag even if a crash or unhandled exception short-circuits the normal cleanup.
  - **Clean teardown on success** — all signal handlers and the resize listener are unregistered in the `finally` block of `runInteractiveShell`, preventing listener leaks if the function is called more than once in a process.
  - **Marker-collision robustness** — added polish tests that verify a command echoing fake-marker-looking text (`echo '__APES_fake_marker__:0:__END__'`) does not confuse the prompt detector, non-zero exit codes propagate correctly, 5 back-to-back commands preserve ordering, and ~3KB of output streams through without losing data.

  Completes #62 — interactive ape-shell REPL is now feature-complete for v1.

- [#74](https://github.com/openape-ai/openape/pull/74) [`a436d8e`](https://github.com/openape-ai/openape/commit/a436d8eb39def7da8595200967597ff0eba164aa) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - fix(apes): resolve symlink chain in ape-shell-wrapper.sh before computing cli.js path

  The wrapper used `$(dirname "${BASH_SOURCE[0]}")/../dist/cli.js` to locate the CLI, which fails when the wrapper is installed as a symlink (the typical `/usr/local/bin/ape-shell` → wrapper install pattern). `BASH_SOURCE[0]` points at the symlink path, so the relative walk lands at `/usr/local/dist/cli.js` instead of the real `packages/apes/dist/cli.js`.

  Fix: walk the symlink chain with a portable bash loop (macOS's `readlink` has no `-f` flag) before computing the relative path. `APES_SHELL_CLI_JS` override is still honored and short-circuits this resolution.

## 0.6.1

### Patch Changes

- Updated dependencies [[`6c0cbad`](https://github.com/openape-ai/openape/commit/6c0cbada5165dc4e45381ffdaca847cd9dfc1d02)]:
  - @openape/grants@0.8.0

## 0.6.0

### Minor Changes

- Add SSH key authentication for humans, workflow-guides discovery command (`apes workflows`), EPIPE handler for piped commands, 'As requested' option in grant approval. Refactor `process.exit()` to `CliError`/`CliExit` throws for testability. Export `CliError` and `CliExit` classes.

### Patch Changes

- Updated dependencies []:
  - @openape/core@0.12.0
  - @openape/grants@0.7.0
  - @openape/shapes@0.6.1

## 0.5.0

### Minor Changes

- Add `init`, `enroll`, and `dns-check` commands for 3-minute onboarding

  - `apes init --sp/--idp`: scaffold SP or IdP projects from GitHub templates via giget
  - `apes enroll`: agent enrollment with browser handoff and Ed25519 challenge polling
  - `apes dns-check <domain>`: validate DDISA DNS TXT records and verify IdP discovery

## 0.4.0

### Minor Changes

- feat: incremental capability grants — extend existing grants with new requests

### Patch Changes

- Updated dependencies []:
  - @openape/core@0.11.0
  - @openape/grants@0.6.0
  - @openape/shapes@0.6.0

## 0.3.0

### Minor Changes

- [#14](https://github.com/openape-ai/openape/pull/14) [`da8a5ac`](https://github.com/openape-ai/openape/commit/da8a5acf82542810ecddf4ad7a9ac8b7b1cfd287) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Support wildcard resource matching for capability grants. A shorter granted resource chain now covers longer required chains (prefix matching), and `apes run` checks for existing capability grants before creating new exact-command grants.

### Patch Changes

- [#17](https://github.com/openape-ai/openape/pull/17) [`d03abbd`](https://github.com/openape-ai/openape/commit/d03abbd1e5dc3121e2e84a2434d2e13687413c10) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Remove deprecated `@openape/grapes` package. All CLIs now use `~/.config/apes/` exclusively — no grapes fallback. Update error messages and docs to reference `apes` CLI.

- Updated dependencies [[`d03abbd`](https://github.com/openape-ai/openape/commit/d03abbd1e5dc3121e2e84a2434d2e13687413c10), [`da8a5ac`](https://github.com/openape-ai/openape/commit/da8a5acf82542810ecddf4ad7a9ac8b7b1cfd287)]:
  - @openape/shapes@0.5.0
  - @openape/core@0.10.0
  - @openape/grants@0.5.3

## 0.2.1

### Patch Changes

- [`d7b9020`](https://github.com/openape-ai/openape/commit/d7b902065e119e7ae7c60e4d13ade2a9d654a0c1) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - fix: support short options (-name) and combined flags (-rl) in shapes parser

- Updated dependencies [[`d7b9020`](https://github.com/openape-ai/openape/commit/d7b902065e119e7ae7c60e4d13ade2a9d654a0c1)]:
  - @openape/shapes@0.4.1

## 0.2.0

### Minor Changes

- [`c195c81`](https://github.com/openape-ai/openape/commit/c195c8107d6b7723bbcd190cfa50d21acadbb3fc) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - feat: add @openape/apes unified CLI + MCP server

  New package `@openape/apes` consolidates grapes and shapes into a single CLI with MCP server mode for AI agents. Shapes gains additional library exports for grant lifecycle and installer functions. Bundled adapters removed in favor of registry-based installation.

### Patch Changes

- Updated dependencies [[`c195c81`](https://github.com/openape-ai/openape/commit/c195c8107d6b7723bbcd190cfa50d21acadbb3fc)]:
  - @openape/shapes@0.4.0
