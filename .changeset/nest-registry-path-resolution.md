---
"@openape/nest": patch
---

Fix the nest daemon reading a stale `agents.json`. Phase G moved
the canonical registry to `/var/openape/nest/agents.json` (system
location, group-readable by `_openape_nest`) and the apes-cli's
`apes agents spawn` writes there. But the nest daemon was still
reading `~/.openape/nest/agents.json` (per-user, pre-Phase-G
location), so freshly spawned agents never showed up in the
in-process supervisor — bridges never started, no first-sync to
troop, and the spawned agent stayed invisible in the troop UI even
though it existed at the IdP.

Now uses the same `resolveRegistryPath()` logic as
`packages/apes/src/lib/nest-registry.ts`: prefer
`/var/openape/nest/agents.json` if present, fall back to the
per-user path otherwise.
