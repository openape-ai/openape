---
'@openape/apes': patch
---

fix(apes): E2E polish for interactive shell lifecycle (M7 of ape-shell interactive mode)

Final polish of the interactive `ape-shell` REPL:

- **Clean shutdown on SIGTERM / SIGHUP** — `gracefulShutdown` handler kills the bash child, closes the audit session, restores the terminal out of raw mode, and stops the REPL in one idempotent sweep. Previously a kill signal could leave the terminal in raw mode.
- **Emergency TTY restore** — `process.on('exit', …)` handler restores stdin's raw mode flag even if a crash or unhandled exception short-circuits the normal cleanup.
- **Clean teardown on success** — all signal handlers and the resize listener are unregistered in the `finally` block of `runInteractiveShell`, preventing listener leaks if the function is called more than once in a process.
- **Marker-collision robustness** — added polish tests that verify a command echoing fake-marker-looking text (`echo '__APES_fake_marker__:0:__END__'`) does not confuse the prompt detector, non-zero exit codes propagate correctly, 5 back-to-back commands preserve ordering, and ~3KB of output streams through without losing data.

Completes #62 — interactive ape-shell REPL is now feature-complete for v1.
