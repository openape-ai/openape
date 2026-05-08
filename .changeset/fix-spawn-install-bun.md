---
'@openape/apes': patch
---

Auto-install `bun` during `apes agents spawn --bridge` if the agent user doesn't have it. Hidden service-account agents have a clean $HOME and no system-wide bun on macOS (bun installs per-user via the curl-bash installer; brew doesn't ship it), so `bun add -g @openape/chat-bridge @openape/apes` was failing with `bun: command not found` on every fresh bridged spawn. Now the bridge install block runs the official bun installer first if needed, then proceeds with the bun add — idempotent for re-spawns.
