---
"@openape/ape-agent": major
"@openape/apes": minor
---

Rename `@openape/chat-bridge` to `@openape/ape-agent`.

The old name was an implementation leak — "chat-bridge" suggested a dumb
forwarding pipe, but the package hosts the entire agent runtime (LLM
loop, tools, per-thread memory, cron tasks). The new name lines up with
the rest of the CLI surface (`apes`, `ape-tasks`, `ape-agent`).

**Migration:**

- `npm i -g @openape/ape-agent@latest` — installs both the new
  canonical binary `ape-agent` and the legacy `openape-chat-bridge`
  alias (same script).
- Existing pm2 ecosystem files that invoke `openape-chat-bridge` keep
  working as long as `@openape/ape-agent` is installed globally.
- New spawns invoke `ape-agent` directly (`apes captureHostBinDirs`
  resolves the new name; the YOLO policy in `apes nest authorize`
  allows both binaries).

`@openape/chat-bridge` on npm is deprecated and will receive no further
updates. Run `npm deprecate @openape/chat-bridge "Renamed to @openape/ape-agent"`
after this changeset lands.
