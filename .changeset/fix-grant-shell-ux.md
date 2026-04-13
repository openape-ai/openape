---
'@openape/apes': patch
---

fix(apes): grant-shell UX — visible cache/approval state and `apes` subcommand routing from the REPL

Three related fixes that make the ape-shell grant flow observable and self-consistent.

1. **`apes <subcommand>` inside the interactive REPL no longer errors with "unsupported invocation".** Root cause was that the `ape-shell` wrapper script exports `APES_SHELL_WRAPPER=1` into its node process env so `rewriteApeShellArgs` can detect wrapper invocation — but that env var was then leaked, unfiltered, into the bash pty child spawned by `PtyBridge`. Any `apes` subcommand the user typed inside that bash re-read the var from its inherited env, self-detected as ape-shell mode, and rejected its argv. `PtyBridge` now strips `APES_SHELL_WRAPPER` from the env it passes to `pty.spawn`.

2. **Grant cache hits now emit a visible reuse line**, so the user can tell that a command was allowed because a pre-approved grant was reused rather than because the gating layer was bypassed. Both the adapter-grant path (which already logged a reuse line) and the session-grant path (which was silent) now print `Reusing ...`. Both lines can be suppressed by exporting `APES_QUIET_GRANT_REUSE=1` for power users who want a clean stream.

3. **Pending grants now emit an approval acknowledgment line** when the wait loop resolves as approved. Previously the wait loop returned silently — the user only saw the command's output and could not distinguish a live approval round-trip from an instant cache hit. Both the adapter wait path (using `waitForGrantStatus`) and the session-grant inline polling loop now print `Grant <id> approved — continuing` before returning.

Together these make it possible to watch the grant state from inside the interactive shell without leaving it: cache hits are visible, approval round-trips are visible, and `apes grants list` / `apes whoami` work again from the REPL prompt.
