---
'@openape/apes': minor
---

feat(apes): new `apes health` subcommand — external diagnostic probe

A standalone read-only diagnostic that reports the current state of the CLI without entering the REPL or touching the pty layer. Designed to work even when the interactive shell is in a broken state.

```bash
$ apes health
apes 0.4.2

Config: /Users/you/.config/apes
Auth:   /Users/you/.config/apes/auth.json
        alice@example.com (human)
        IdP: https://id.openape.at
        Token: valid until 2026-05-14T14:25:31.000Z (local: 5/14/2026, 4:25:31 PM)

IdP: reachable
Grants: 12
ape-shell: /usr/local/bin/ape-shell
```

Reports:

- `apes` binary version
- Config dir and auth file locations
- Auth identity, type (human/agent), IdP, token expiry (UTC + local)
- IdP reachability (3s HEAD probe)
- Grant count (best-effort — reported as unreachable if the API call fails, but does NOT fail the probe)
- Resolved `ape-shell` binary path

Exit codes: `0` if auth is valid AND IdP is reachable; `1` otherwise (not logged in, token expired, or IdP unreachable). A failed grants lookup alone does not fail the probe.

`--json` emits the full report as machine-readable JSON with an `ok` field for single-check consumption.
