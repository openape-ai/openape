---
'@openape/apes': patch
---

fix(apes): normalize basename before resolveCommand in ape-shell routing

Follow-up to the previous adapter-lookup fix. `tryAdapterModeFromShell` in `apes run --shell` still passed the raw first token from the parsed shell command into `resolveCommand`, which does a strict comparison against `adapter.cli.executable`. Commands that started with an absolute path like `/usr/local/bin/o365-cli` loaded the adapter correctly but then threw inside `resolveCommand`, and the error was swallowed into `consola.debug` — silently falling back to a generic `bash -c` session grant.

The call site now normalizes `parsed.executable` via `basename()` before passing it into `resolveCommand`. `resolveCommand` itself stays strict.
