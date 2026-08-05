---
"@openape/nuxt-auth-idp": minor
---

Session transfer: a signed-in browser can mint a single-use link that signs the
same user in on a browser without a platform authenticator. `POST
/api/session/transfer` returns the link, `GET /api/session/transfer/:token`
consumes it (once, within 60 seconds) and starts the session there. The account
hub carries the button.
