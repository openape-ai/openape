# @openape/nest

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
