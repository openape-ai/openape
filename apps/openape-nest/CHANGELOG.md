# @openape/nest

## 2.0.2

### Patch Changes

- [#388](https://github.com/openape-ai/openape/pull/388) [`713305a`](https://github.com/openape-ai/openape/commit/713305a363384a01e05d241738f4fae5d0fdc9a2) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase G follow-up: `apes nest destroy <name>` (and `apes agents destroy`) is now fully scriptable for Phase G+ agents — no admin-password prompt, no TTY required.

  Detection: if the agent's `NFSHomeDirectory` (read from dscl) starts with `/var/openape/homes/`, the new `buildPhaseGTeardownScript` runs via `apes run --as root` and:

  - launchctl bootout + pkill
  - rm -rf /var/openape/homes/<name> (no FDA wall on /var/, root just does it)
  - rm -rf /var/openape/agents/<name> (per-agent ecosystem files)
  - skip sysadminctl entirely — the dscl record stays as a hidden tombstone (uid in service range, IsHidden=1, NFSHomeDirectory pointing nowhere). Operators can `sudo sysadminctl -deleteUser <name>` interactively for full cleanup; the tombstone is otherwise harmless.

  Legacy agents under `/Users/<name>/` still go through the old sudo + sysadminctl + admin-password path — `rm -rf /Users/...` hits FDA without a UI session.

  Plus: registry file mode bumped from 600 to 660 (group `_openape_nest`) so the human user can `apes nest list` without sudo. The file holds no secrets.

## 2.0.1

### Patch Changes

- [#387](https://github.com/openape-ai/openape/pull/387) [`76a2a71`](https://github.com/openape-ai/openape/commit/76a2a71dbe0449a018f3a04fae39322a19c04526) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase G of the architecture simplification (#sim-arch): new agent homes live under `/var/openape/homes/<name>/` instead of `/Users/<name>/`. Hidden service-account users belong with their kin (`_www` → `/var/empty`, `_postgres` → `/var/empty`, our own `_openape_nest` → `/var/openape/nest`). Keeping `/Users/` for real human accounts only — Finder, TimeMachine, Migration Assistant stop seeing the agents.

  The dscl record stays at `/Users/<name>` (that's the dscl namespace, not a filesystem path). Only `NFSHomeDirectory` changes: setup.sh's dscl create line uses the new path, and pre-creates `/var/openape/homes/` (mode 755, world-traversable so the per-agent dirs are reachable from each agent's uid).

  `MacOSUserSummary` gains a `homeDir` field parsed from `dscl . -read /Users/<name> NFSHomeDirectory`. Callers (`apes agents destroy`, `apes agents list`, the Nest's pm2-supervisor `start.sh`) resolve the home dynamically — Phase G+ agents at the new path, legacy agents still at `/Users/<name>`.

  **Existing agents are NOT migrated.** Moving an existing agent would require `rm -rf /Users/<name>` which hits macOS's FDA wall (FDA-blocked operation needing UI session permissions — same constraint that makes `apes agents destroy` partial today). Existing agents keep their `/Users/` homes; new spawns use the new path. Mixed inventory works because everything resolves the home from dscl at runtime.

## 2.0.0

### Major Changes

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

## 1.1.2

### Patch Changes

- [#385](https://github.com/openape-ai/openape/pull/385) [`56e5c66`](https://github.com/openape-ai/openape/commit/56e5c66ab00f8d579def86be1ae23d28214aa3a7) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix Phase E pm2-supervisor: three issues that conspired to make `pm2 startOrReload` silently fail when invoked from the Nest:

  1. **`bash -c '<inline cmd>'` arg-quoting** — escapes-helper passes the command-array to bash as separate argv; `bash -c` then treats only the first item as the script body and the rest as `$0`/`$1`/... so redirects + sub-args got dropped silently. Switched to a per-agent `start.sh` wrapper script (mode 755) committed at spawn time.

  2. **`process.cwd()` EACCES** — the Nest's cwd is `/var/openape/nest` (mode 750, \_openape_nest only). After escapes setuid to the agent uid, Node's startup `uv_cwd()` failed with EACCES because the agent can't read the inherited cwd. Set `cwd: '/tmp'` on the supervisor's spawn so the new uid lands in a world-readable dir.

  3. **pm2's exit code is non-zero in some success paths** — `pm2 startOrReload` exits with warnings/errors even when the operation succeeded. Added a `pm2 jlist` probe after start: if the expected app is `online`, log success regardless of the cli's exit code; otherwise log "NOT online" with a pointer to the per-agent pm2 log.

  Plus: log dir `/var/log/openape/` needs mode 1777 so per-agent pm2 instances (different uids) can each append their own log file there. The `apes nest install` flow could create this idempotently in a follow-up; for now operators run `mkdir -p /var/log/openape && chmod 1777 /var/log/openape` once after upgrading.

## 1.1.1

### Patch Changes

- [#384](https://github.com/openape-ai/openape/pull/384) [`05db050`](https://github.com/openape-ai/openape/commit/05db050b32c3c52e0e494fe97f87cf428413d82d) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix Phase E pm2-supervisor: ecosystem.config.js files move from `/var/openape/nest/agents/` (mode 750, \_openape_nest-only) to `/var/openape/agents/` (mode 755, world-traversable). Per-agent pm2 daemons run as the agent uid and need to read their own config file; the Nest's private state stays where it was.

## 1.1.0

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

## 1.0.0

### Major Changes

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

### Minor Changes

- [#379](https://github.com/openape-ai/openape/pull/379) [`157742d`](https://github.com/openape-ai/openape/commit/157742d8311298eab2a750836aac036bdbe2ae5a) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase B of the architecture simplification (#sim-arch): the Nest supervises chat-bridge processes in-daemon. New spawns no longer install per-agent system-domain launchd plists in `/Library/LaunchDaemons/` — there's just one launchd entry for the Nest itself, and it owns the rest.

  The supervisor (`apps/openape-nest/src/lib/supervisor.ts`) spawns `apes run --as <agent> --wait -- openape-chat-bridge` per registered agent, restarts on exit with bounded backoff. Same shape as the supervisor deleted in PR #365, but the PATH-inheritance bug that killed that one is gone since PR #376 retired the per-agent bun install (host-resolved binaries now).

  Spawn flow drops the bridge plist write + `launchctl bootstrap` block. `apes agents spawn --bridge` still writes the bridge `.env` to the agent's home (the Nest supervisor's child reads it via `resolveBridgeConfig`), but no plist + no `start.sh`.

  Existing per-agent bridge plists in `/Library/LaunchDaemons/eco.hofmann.apes.bridge.<agent>.plist` keep running on machines that haven't upgraded; new spawns use the Nest-supervisor path. Operators on Phase B can boot out the legacy plists manually once they confirm the Nest supervisor has taken over.

- [#380](https://github.com/openape-ai/openape/pull/380) [`3e56e49`](https://github.com/openape-ai/openape/commit/3e56e49fb3bf262059d702a539be0fc4862b4e6a) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase C of the architecture simplification (#sim-arch): troop-sync moves from per-agent launchd plist to a centralised loop in the Nest daemon.

  **Before**: every spawn dropped `/Library/LaunchDaemons/openape.troop.sync.<agent>.plist` with `StartInterval=300`. n agents → n separate plists, n separate apes-cli boot sequences every 5 min. n separate failure modes (each plist could be in a different bootout/bootstrap state).

  **After**: the Nest runs one `TroopSync` loop (`apps/openape-nest/src/lib/troop-sync.ts`) on a 5-minute timer that walks the registry and shells out to `apes run --as <agent> --wait -- apes agents sync` for each one serially. Same effect at the troop SP, far less moving parts.

  `apes agents spawn --bridge` no longer writes the troop-sync plist. Existing per-agent plists installed before this version keep running until manually booted out (they don't conflict — both paths just call `apes agents sync` and post the same heartbeat to troop).

## 0.3.0

### Minor Changes

- [#366](https://github.com/openape-ai/openape/pull/366) [`89aeb30`](https://github.com/openape-ai/openape/commit/89aeb30807068866c03e22bb2b769b760d3a721a) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Nest API now requires DDISA grant tokens for read endpoints. `apes nest list` and `apes nest status` go through the grant flow: request a `nest list`/`nest status` grant (audience `nest`), reuse any existing approved 'always'/'timed' grant for the exact same command, otherwise prompt the human once with `grant_type: 'always'` so subsequent calls reuse silently. The grant token is presented as `Authorization: Bearer …` to the Nest, which verifies it against the IdP's JWKS and matches the embedded `command` claim against the route. Each call leaves an audit record at the IdP. Mutating endpoints (POST /agents, DELETE /agents/:name) keep the unauthenticated path for now — gated in the next release. New audience `nest` registered in the audience-bucket whitelist (commands bucket).

- [#367](https://github.com/openape-ai/openape/pull/367) [`78e6b87`](https://github.com/openape-ai/openape/commit/78e6b8717ce8d874d315dfab8d929c08ba3b98e0) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Mutating Nest endpoints (`POST /agents`, `DELETE /agents/:name`) now require DDISA grant tokens. New CLI commands:

  - `apes nest spawn <name>` — provisions an agent via the Nest. Grant `command` is just `['nest','spawn']` (no name baked in), so a single human approval covers all future spawns. Trade-off: a compromised local process running as the human can spawn arbitrary agents under that grant. Acceptable because spawn is reversible (`apes nest destroy`) and creates auditable IdP records.
  - `apes nest destroy <name>` — tears down an agent. Grant `command` IS per-name (`['nest','destroy','<name>']`) deliberately, so destroying any specific agent is its own approval — destructive ops keep tighter scoping.

  `curl POST /agents` and `curl DELETE /agents/:name` without `Authorization: Bearer …` now return 401. Existing scripts that hit the Nest directly need to migrate to `apes nest spawn|destroy` or implement the grant flow themselves.

  YOLO defaults extended with `nest spawn` (wildcard-name) and `nest destroy *` (per-name pattern).

- [#365](https://github.com/openape-ai/openape/pull/365) [`9a3debd`](https://github.com/openape-ai/openape/commit/9a3debdbe9945c891ac2c02f6e35bc14551aa851) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Remove the in-daemon bridge supervisor. Bridge-process lifecycle is now exclusively delegated to the per-agent system-domain launchd plist that `apes agents spawn --bridge` installs into `/Library/LaunchDaemons/`. The supervisor was created on the assumption that it would _replace_ the launchd plists, but the spawn flow kept installing both — they raced each other every minute, and the supervisor's children inherited the human-user PATH which doesn't include the agent's `~/.bun/bin`, so the supervisor child crashlooped on `Command not found: openape-chat-bridge` while the launchd-domain bridge ran fine. Each crashloop produced an auto-approved YOLO grant which fired a notification, drowning the human in approval pings every ~15 seconds. Removing the supervisor is the correct fix per the architecture decision: launchd is already the right OS-level supervisor on macOS.

### Patch Changes

- [#363](https://github.com/openape-ai/openape/pull/363) [`a25180a`](https://github.com/openape-ai/openape/commit/a25180abb6d718881ace7b1776f136ee36e1554e) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix nest bridge supervisor — three bugs that conspired to flood the human with approval prompts on every supervisor restart:

  1. **Wrong YOLO pattern**: The default nest YOLO allow-pattern was `apes run --as * -- openape-chat-bridge`, but escapes-helper unwraps the `apes run --as <agent> --` prefix before submitting the grant request to the IdP. So the actual target string the YOLO evaluator saw was just `openape-chat-bridge`. The pattern is now `openape-chat-bridge` (just the inner command) — `apes nest authorize` re-runs apply the corrected default.

  2. **Missing `--wait`**: The supervisor invoked `apes run --as <agent> -- openape-chat-bridge` without `--wait`. Even when YOLO auto-approved the grant server-side, the CLI returned exit 75 (EX_TEMPFAIL) the moment the grant was created — before the CLI observed the approval. Added `--wait` to mirror the spawn-handler.

  3. **Doubly-nested registry path**: `agents.json` was written to `~/.openape/nest/.openape/nest/agents.json` because `homedir()` already returned `~/.openape/nest` (the launchd-set daemon HOME) and the registry then joined `.openape/nest/` again on top. Registry now lives directly at `$HOME/agents.json`. Existing installs need a one-time `mv ~/.openape/nest/.openape/nest/agents.json ~/.openape/nest/agents.json`.

- [#362](https://github.com/openape-ai/openape/pull/362) [`375f6d5`](https://github.com/openape-ai/openape/commit/375f6d57c036e293b644bfd917f029cf961e386e) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Nest API spawn now installs the bridge by default — pass `bridge: false` explicitly to opt out. Without it, the agent has no chat-bridge daemon (no chat-DM contact request, no cron-runner), which made it functionally inert in the test that uncovered the issue.

- Updated dependencies [[`8ca96f1`](https://github.com/openape-ai/openape/commit/8ca96f10f7a0a9c8adc5afa5c8fd863f62342f6c)]:
  - @openape/cli-auth@0.4.0

## 0.2.0

### Minor Changes

- [#353](https://github.com/openape-ai/openape/pull/353) [`bcf0646`](https://github.com/openape-ai/openape/commit/bcf0646a2248e3be7588b7ddcaa91b67f11baed3) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - **Stage 1 of the Nest control-plane** (per [plan 01KR5TXQXWDC1YDESJJYTPFFMK](https://plans.openape.ai/plans/01KR5TXQXWDC1YDESJJYTPFFMK)). The Nest is a local daemon that hosts agents on a single computer — once installed, `apes agents spawn` becomes fast (no per-spawn DDISA approvals required after the one-time always-grant) and per-agent launchd plists get replaced by a single supervised process tree.

  **New package** `@openape/nest`: HTTP daemon on `127.0.0.1:9091` with `/agents` (POST/DELETE/GET) and `/status` endpoints; persistent registry at `~/.openape/nest/agents.json`; supervisor for chat-bridge children with bounded backoff restart.

  **New `@openape/apes` verbs**:

  - `apes nest install` — writes `~/Library/LaunchAgents/ai.openape.nest.plist`, bootstraps it, prints next-step instructions for the always-grant
  - `apes nest status` — talks to the daemon, lists supervised processes
  - `apes nest uninstall` — bootouts + removes the plist (registry preserved)

  Stage 1 MVP runs the nest as the human user (eventual migration to a dedicated `_openape_nest` service-account is Stage 1.5). Migration of existing agents from per-agent launchd plists into supervisor-managed children comes in a follow-up PR.
