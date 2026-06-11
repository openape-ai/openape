---
'@openape/auth': minor
'@openape/nuxt-auth-idp': minor
---

Account-recovery v2 (#462): adaptive cooldown (7d active / 72h dormant / vacation
mode up to 14d), out-of-band warning broadcast (push fan-out + all linked email
addresses, one-tap tokenized cancel without a session), persistent recovery
history (`listAllForEmail` on RecoveryStore, new EmailHistoryStore). Fixes the
v1 gap where recovery API routes (options/verify/cancel) were never registered;
auth rate limit cap is now configurable via `OPENAPE_RATE_LIMIT_MAX_AUTH`.
