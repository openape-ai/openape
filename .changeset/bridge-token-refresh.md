---
"@openape/apes": patch
---

Fix bridge crashloop on 1h agent IdP token expiry. Agents auth via SSH-key signing — the resulting IdP token has no refresh_token and dies after ~1h. The bridge then crashloops because launchd's KeepAlive restarts it but the cached token is still expired. Fix: spawn `--bridge` start.sh now installs `@openape/apes` and runs `apes login <email> --idp <idp>` (key-based, non-interactive) before exec'ing the bridge — every launchd boot produces a fresh ~1h token, recovery gap on the hourly mark drops to ~10s instead of permanent breakage.
