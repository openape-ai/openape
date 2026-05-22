---
"@openape/cli-auth": patch
---

Shorten the SP token-exchange fallback expiry from 30 days to 1 hour
when an SP omits both `expires_at` and `expires_in` (#283). The old
default cached a misbehaving SP's token effectively forever, masking
revocation.
