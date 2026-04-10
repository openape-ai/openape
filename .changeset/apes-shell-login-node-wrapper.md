---
'@openape/apes': patch
---

fix(apes): login-shell wrapper script for environments without node on PATH

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
