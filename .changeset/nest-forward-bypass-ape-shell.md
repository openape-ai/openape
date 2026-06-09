---
"@openape/nest": patch
---

Forward `OPENAPE_BYPASS_APE_SHELL` into each bridge's pm2 env. The bridge is
spawned via `sudo -u <agent>`, which strips the nest's environment, so this
pm2 `env:` block is the only env the bridge sees. Without the flag the
in-bridge cron runner fell back to the gated `ape-shell` (absent in the pod
container) and every scheduled `command` task failed to exec (exit -1).
