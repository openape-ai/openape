---
'@openape/apes': minor
---

Spawn 15× faster: replace per-agent bun bootstrap + `bun add -g` install with host-PATH capture.

Previously every `apes [nest|agents] spawn --bridge` ran `curl https://bun.sh/install | bash` (if needed) followed by `bun add -g @openape/chat-bridge @openape/apes` *as the new agent user* — adding ~30-90s to every spawn and ~100MB of disk per agent home, all duplicating tooling already installed on the host.

Now the spawn flow calls `captureHostBinDirs()` once: resolves `node`, `openape-chat-bridge`, and `apes` via `which`, dedupes the dirs, and bakes them into the agent's launchd plist `EnvironmentVariables.PATH` + the `start.sh` PATH export. Every agent's bridge process inherits the host's tooling install. Spawn time on a Mac Mini went from ~60s to ~4s.

**Operator setup**: install the bridge stack system-wide once before spawning agents:

```bash
npm i -g @openape/apes @openape/chat-bridge
```

If any of `node` / `openape-chat-bridge` / `apes` is missing on host PATH at spawn time, `apes agents spawn --bridge` fails fast with a pointer to the install command instead of silently bootstrapping a per-agent stack.

Existing agents created before this version keep working (their plists still reference `~/.bun/bin`). They can be left as-is, or torn down + respawned to pick up the new shape.
