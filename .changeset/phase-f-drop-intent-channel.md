---
'@openape/nest': major
'@openape/apes': minor
---

Phase F of the architecture simplification (#sim-arch): drop the intent-channel entirely. The Nest is now a pure observer with three responsibilities — pm2-supervisor, troop-sync, and registry-watcher (`fs.watch` on `agents.json`).

**What changed**:
- The apes-cli's `apes nest spawn|destroy|list` no longer drops files into `/var/openape/nest/intents/` and polls for responses. They directly shell out to `apes run --as root -- apes agents spawn|destroy <name>` (which already requires a DDISA root grant — Patrick approves once with `--approval always` on his identity, then silent reuse).
- `apes agents spawn` and `apes agents destroy` write to the Nest's `agents.json` registry themselves before exiting (new `lib/nest-registry.ts` helper).
- The Nest's `fs.watch` on `agents.json` triggers reconcile within ~1s of any change. pm2 starts the bridge for new entries; pm2-deletes the bridge for removed ones.

**What was removed**:
- `apps/openape-nest/src/lib/intent-channel.ts` (~200 LOC)
- `apps/openape-nest/src/api/agents.ts`
- `packages/apes/src/lib/nest-intent.ts`

**Permissions note**: the registry file lives at `/var/openape/nest/agents.json` mode 660 group `_openape_nest`. Patrick (a member of that group post-`migrate-to-service-user`) can rw it directly. Pre-migration installs use `~/.openape/nest/agents.json` and don't need the group dance.

**Net effect**: simpler architecture (~250 fewer LOC), more aligned with the "Nest is a long-running CLIENT" model — no inbound channel of any kind.
