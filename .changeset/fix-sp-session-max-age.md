---
'@openape/nuxt-auth-sp': minor
---

Explicit `maxAge` on the logged-in session cookie (`openape-sp`) so iOS Safari keeps the session across tab-close / backgrounding.

- New `openapeSp.sessionMaxAge` module option (default: 604800 seconds = 7 days). Env: `NUXT_OPENAPE_SP_SESSION_MAX_AGE`.
- `getSpSession` now sets `cookie.maxAge` + `cookie.httpOnly` + `cookie.secure` + `cookie.sameSite: 'lax'` explicitly. Previous behaviour relied on h3's default (session cookie without explicit expiry), which iOS aggressively evicts.
- Backwards compatible: existing apps inherit the 7-day default without any config change.
