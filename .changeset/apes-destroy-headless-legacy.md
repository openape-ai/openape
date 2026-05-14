---
"@openape/apes": patch
---

`apes agents destroy` no longer fails outright when run headless
on a legacy agent (home under `/Users/`). The OS-side teardown
needs `sudo` + admin password (the FDA wall on /Users/ blocks the
escapes-root path), which requires a TTY or `APES_ADMIN_PASSWORD`
env. When neither is available — typical for the new troop-WS
destroy path where the nest daemon shells out to `apes agents
destroy --force` — we now log a clear warning and skip just the
OS-side step. The IdP de-register + nest-registry removal still
run, so the agent stops working. Operator can re-run from a shell
later (`apes agents destroy <name>`) to fully clean up the dscl
record + home dir.
