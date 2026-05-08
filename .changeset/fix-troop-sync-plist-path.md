---
'@openape/apes': patch
---

Add PATH to the troop sync plist's EnvironmentVariables so the daemon can find `node` (and `bun`). launchd defaults to `/usr/bin:/bin:/usr/sbin:/sbin` — too narrow for the apes binary's `#!/usr/bin/env node` shebang. Without this the sync log filled with `env: node: No such file or directory` and the agent never reached troop.openape.ai.
