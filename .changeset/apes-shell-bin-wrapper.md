---
'@openape/apes': minor
---

Fix `ape-shell` being silently inert under shim-based installers (pnpm)

The published `ape-shell` bin pointed at `dist/cli.js`, relying on the
argv[1] basename for shell-mode detection. That only works when the
installer creates a direct symlink (classic `npm i -g`). pnpm and other
shim-based installers generate a wrapper that execs `node .../dist/cli.js`
directly, so argv[1] becomes `cli.js`, detection fails, and
`ape-shell -c '<cmd>'` prints the apes help and executes **nothing** — no
grant flow, no command, no error. Any security gating built on ape-shell
(e.g. a Claude Code PreToolUse hook rewriting Bash commands to
`ape-shell -c`) silently disappears.

Changes:

- The `ape-shell` bin now points at `scripts/ape-shell-wrapper.sh`, which
  sets `APES_SHELL_WRAPPER=1` (the strongest detection signal) before
  exec-ing `dist/cli.js`, making detection independent of how the package
  manager materialized the bin.
- The wrapper now also resolves `node` from `PATH` (nvm/fnm/volta setups)
  before falling back to the known Homebrew/system locations.
- New second line of defense: `APES_SHELL_MODE=1` is accepted as an
  explicit, equivalent signal to `APES_SHELL_WRAPPER=1`, for callers that
  invoke `cli.js` directly and must not depend on installer behavior. It
  is stripped from nested child environments just like the wrapper marker.
