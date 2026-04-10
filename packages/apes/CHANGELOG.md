# @openape/apes

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
