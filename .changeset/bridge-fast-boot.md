---
"@openape/apes": minor
---

Bridge boot time dropped from ~75s to ~5s. `apes agents spawn --bridge` now bun-installs the bridge stack (chat-bridge + apes + pi, ~1300 packages) **once** during spawn — start.sh becomes a slim launcher that only refreshes the agent's IdP token, drops the litellm pi extension if missing, and execs the bridge. The trade-off is no auto-update on each boot — to upgrade an agent's bridge after a release: `apes run --as <name> -- bun update -g @openape/chat-bridge`.

Existing agents (npm-installed in `~/.npm-global`) keep working — the new layout only kicks in for fresh `spawn --bridge` calls. Re-spawn to migrate.
