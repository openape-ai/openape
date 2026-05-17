---
'@openape/apes': minor
'@openape/nest': patch
---

apes: add `apes agents cleanup-orphans` to delete tombstoned macOS user records left behind by `apes agents destroy` (run with `sudo` — opendirectoryd accepts sysadminctl-deleteUser when invoked under an interactive sudo admin audit-session). Detection covers both legacy `/var/openape/homes/<name>` and the new `openape-agent-*` prefix shape.

apes: spawn now provisions the macOS user as `openape-agent-<name>` (prefix lives only at the macOS layer — email, troop UI, bridge data dir, and `apes agents list` stay on the bare agent name). `apes run --as <agent>` resolves the prefix transparently; legacy pre-prefix agents keep working via a fall-through lookup.

nest: pm2-supervisor's start.sh resolves HOME via `$(whoami)` instead of a hard-coded `/Users/<agent>` dscl read, so it works regardless of the prefix shape.
