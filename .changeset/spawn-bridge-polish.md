---
"@openape/apes": minor
---

Polish `apes agents spawn --bridge` for production use:

- Bridge plist now installed as a system-wide LaunchDaemon at `/Library/LaunchDaemons/eco.hofmann.apes.bridge.<agent>.plist` with `<UserName>` set to the agent. Boots without anyone being logged in (the previous LaunchAgent in `~/Library/LaunchAgents/` couldn't bootstrap into a non-existent gui domain for hidden service accounts). Cleanup added to `destroy`.
- Bridge `start.sh` now self-installs both `@openape/chat-bridge` and `@mariozechner/pi-coding-agent` via npm into a per-user `~/.npm-global` prefix, plus drops the litellm pi extension if missing. Idempotent. No more manual per-agent setup.
- Added `--bridge-room <name>` flag: after spawn, creates (or finds) a chat.openape.ai room with the given name and adds the new agent as a member, using the spawning user's IdP bearer. Soft-fails with a hint if chat is unreachable.
