---
'@openape/apes': minor
---

`apes agents spawn --bridge` now stamps `OPENAPE_OWNER_EMAIL` into the bridge daemon's launchd plist `EnvironmentVariables` block, plus its start.sh logs the actual `apes login` failure to stderr instead of silently swallowing it.

Together these mean a freshly-spawned agent is robust to the cli-auth merge bug from the previous patch: the bridge can resolve its owner from the env var even if `auth.json` ever gets clobbered, and any login refresh failure is debuggable from the daemon's stderr log without an interactive grant approval.
