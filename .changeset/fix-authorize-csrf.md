---
'@openape/nuxt-auth-idp': patch
---

Fix CSRF auto-approval of `authorization_details` in `/authorize` GET (closes #273).

The `/authorize` GET handler used to parse RFC 9396 `authorization_details` from the query string and auto-approve them server-side, treating an existing IdP session as implicit consent. A crafted URL — `<a href="https://idp/authorize?…&authorization_details=[<broad cli grant>]">` — could therefore approve sweeping grants via top-level GET navigation (cookies are `SameSite=Lax` by default), bypassing the approver-policy entirely.

Until a proper consent UI lands, the parameter is rejected. Callers must use the explicit grant API: `POST /api/grants` to create the grant pending, then `POST /api/grants/{id}/approve` (which enforces the approver-policy fixed in PR #284). No production caller in this repo relied on the old combo — verified via grep.
