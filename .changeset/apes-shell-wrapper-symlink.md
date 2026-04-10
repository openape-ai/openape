---
'@openape/apes': patch
---

fix(apes): resolve symlink chain in ape-shell-wrapper.sh before computing cli.js path

The wrapper used `$(dirname "${BASH_SOURCE[0]}")/../dist/cli.js` to locate the CLI, which fails when the wrapper is installed as a symlink (the typical `/usr/local/bin/ape-shell` → wrapper install pattern). `BASH_SOURCE[0]` points at the symlink path, so the relative walk lands at `/usr/local/dist/cli.js` instead of the real `packages/apes/dist/cli.js`.

Fix: walk the symlink chain with a portable bash loop (macOS's `readlink` has no `-f` flag) before computing the relative path. `APES_SHELL_CLI_JS` override is still honored and short-circuits this resolution.
