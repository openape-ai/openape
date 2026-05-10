---
'@openape/nest': minor
'@openape/apes': minor
---

Phase C of the architecture simplification (#sim-arch): troop-sync moves from per-agent launchd plist to a centralised loop in the Nest daemon.

**Before**: every spawn dropped `/Library/LaunchDaemons/openape.troop.sync.<agent>.plist` with `StartInterval=300`. n agents → n separate plists, n separate apes-cli boot sequences every 5 min. n separate failure modes (each plist could be in a different bootout/bootstrap state).

**After**: the Nest runs one `TroopSync` loop (`apps/openape-nest/src/lib/troop-sync.ts`) on a 5-minute timer that walks the registry and shells out to `apes run --as <agent> --wait -- apes agents sync` for each one serially. Same effect at the troop SP, far less moving parts.

`apes agents spawn --bridge` no longer writes the troop-sync plist. Existing per-agent plists installed before this version keep running until manually booted out (they don't conflict — both paths just call `apes agents sync` and post the same heartbeat to troop).
