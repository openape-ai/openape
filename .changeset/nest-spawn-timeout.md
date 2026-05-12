---
"@openape/nest": patch
---

Fix WS spawn-intent handler hanging on `execFile`: `apes agents spawn`
starts a pm2 daemon that inherits stdio FDs, so Node's `execFile()`
never resolves and the `spawn-result` frame was never sent back. Cap
the spawn at 120s (matching `troop-sync`'s 60s pattern, with extra
budget for the npm-install on first spawn) and treat the SIGTERM
timeout as a non-error since the agent provisioning already
completed by then.

Also logs the spawn-result outcome to the nest log on both
branches so future failures are diagnosable without tcpdump.
