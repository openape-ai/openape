---
"@openape/nuxt-auth-sp": minor
---

SP `client_id` now falls back to the live request host when it isn't explicitly pinned (`openapeSp.clientId` / `NUXT_OPENAPE_SP_CLIENT_ID`). This lets dynamic preview hosts (e.g. `pr-123.preview.example.com`) self-register for the OAuth login flow — the published `/.well-known/oauth-client-metadata` and the authorize/callback `client_id` all become the live host — without any per-deploy config. SPs that pin `client_id` are unaffected; CLI-token and DDISA-domain identity remain pinned.
