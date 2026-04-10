---
'@openape/apes': minor
---

feat(apes): interactive REPL loop + multi-line detection (M2 of ape-shell interactive mode)

`ape-shell` now detects when it is invoked without `-c` and hands control to an interactive REPL instead of erroring out. The REPL uses Node's `readline` with history, a custom `apes$ ` prompt, and multi-line accumulation driven by a `bash -n` dry-parse plus a dedicated heredoc detector (bash's `-n` mode accepts unterminated heredocs, which the REPL cannot).

Invocation mode detection is strictly backward-compatible: `ape-shell -c "<cmd>"` still rewrites to the existing one-shot path, so `SHELL=$(which ape-shell) <program>` patterns (openclaw tui, xargs, git hooks, sshd non-interactive) do not regress. New triggers that enter the REPL: no args, `-i`, `-l`/`--login`, or a login-shell convention dash prefix (`-ape-shell` as used by sshd/login/su).

This milestone lands the input state machine only — there is no grant dispatch or bash execution yet. Each complete line is handled by a pluggable `onLine` callback; the built-in stub logs it via consola. Grant dispatch and pty execution arrive in the next milestones.
