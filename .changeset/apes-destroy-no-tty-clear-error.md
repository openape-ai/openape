---
"@openape/apes": patch
---

apes: `apes agents destroy` refuses with a clear hint when there's no TTY (was: opaque `uv_tty_init returned EINVAL` crash)

Calling `apes agents destroy <name>` from a non-TTY context (CI, subprocess, automation) used to crash with an unreadable Node-internal stack trace because `consola.prompt` requires a controlling terminal. Detect `!process.stdin.isTTY` upfront and refuse with `"No TTY available for the interactive confirmation. Re-run with --force …"` instead.

The `--force` flag has always existed for exactly this case; we just weren't surfacing it. No behavior change for interactive use.
