---
'@openape/nest': minor
'@openape/apes': minor
---

Phase B of the architecture simplification (#sim-arch): the Nest supervises chat-bridge processes in-daemon. New spawns no longer install per-agent system-domain launchd plists in `/Library/LaunchDaemons/` — there's just one launchd entry for the Nest itself, and it owns the rest.

The supervisor (`apps/openape-nest/src/lib/supervisor.ts`) spawns `apes run --as <agent> --wait -- openape-chat-bridge` per registered agent, restarts on exit with bounded backoff. Same shape as the supervisor deleted in PR #365, but the PATH-inheritance bug that killed that one is gone since PR #376 retired the per-agent bun install (host-resolved binaries now).

Spawn flow drops the bridge plist write + `launchctl bootstrap` block. `apes agents spawn --bridge` still writes the bridge `.env` to the agent's home (the Nest supervisor's child reads it via `resolveBridgeConfig`), but no plist + no `start.sh`.

Existing per-agent bridge plists in `/Library/LaunchDaemons/eco.hofmann.apes.bridge.<agent>.plist` keep running on machines that haven't upgraded; new spawns use the Nest-supervisor path. Operators on Phase B can boot out the legacy plists manually once they confirm the Nest supervisor has taken over.
