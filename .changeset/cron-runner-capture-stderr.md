---
"@openape/ape-agent": patch
---

fix(cron-runner): keep both stdout and stderr in a command task's result

A deterministic command task recorded `stdout || stderr`, so a command
that failed with its error only on stderr (a thrown CliError, a git
failure) surfaced just the early stdout progress and hid the actual
cause — runs showed `exited 1` with no reason. The result now includes
both streams, tailed so the operative error (usually last) survives the
size cap.
