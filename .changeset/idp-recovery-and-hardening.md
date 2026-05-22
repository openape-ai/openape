---
"@openape/nuxt-auth-idp": minor
---

Account-recovery flow + auth hardening.

- New recovery endpoints `/api/recovery/{cancel,options,verify}`, the
  `/recover` page, and `useWebAuthn().recoverWithToken()` for the
  72h-mail-hold recovery flow (#297). Every successful login now cancels
  any pending recovery (active-owner veto).
- `tryBearerAuth` enforces `aud='apes-cli'` so non-CLI tokens minted
  against the same signing key are no longer accepted at bearer
  endpoints (#283).
- Boot guard: refuse to start when `sessionSecret` is empty or still
  the public default (#283).
