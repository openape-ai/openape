---
'@openape/apes': minor
'@openape/nest': patch
---

Phase G of the architecture simplification (#sim-arch): new agent homes live under `/var/openape/homes/<name>/` instead of `/Users/<name>/`. Hidden service-account users belong with their kin (`_www` → `/var/empty`, `_postgres` → `/var/empty`, our own `_openape_nest` → `/var/openape/nest`). Keeping `/Users/` for real human accounts only — Finder, TimeMachine, Migration Assistant stop seeing the agents.

The dscl record stays at `/Users/<name>` (that's the dscl namespace, not a filesystem path). Only `NFSHomeDirectory` changes: setup.sh's dscl create line uses the new path, and pre-creates `/var/openape/homes/` (mode 755, world-traversable so the per-agent dirs are reachable from each agent's uid).

`MacOSUserSummary` gains a `homeDir` field parsed from `dscl . -read /Users/<name> NFSHomeDirectory`. Callers (`apes agents destroy`, `apes agents list`, the Nest's pm2-supervisor `start.sh`) resolve the home dynamically — Phase G+ agents at the new path, legacy agents still at `/Users/<name>`.

**Existing agents are NOT migrated.** Moving an existing agent would require `rm -rf /Users/<name>` which hits macOS's FDA wall (FDA-blocked operation needing UI session permissions — same constraint that makes `apes agents destroy` partial today). Existing agents keep their `/Users/` homes; new spawns use the new path. Mixed inventory works because everything resolves the home from dscl at runtime.
