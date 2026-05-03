---
"@openape/apes": patch
---

Fix bridge PATH on apes 0.26.0: bun symlinks live in `~/.bun/bin/` not `~/.bun/install/global/bin/`, so launchd's `exec openape-chat-bridge` was failing with "command not found" and crashlooping. One-char fix in plist + start.sh. Existing agents need their plist+start.sh patched in place (or destroy + re-spawn).
