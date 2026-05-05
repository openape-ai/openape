---
'@openape/nuxt-auth-idp': patch
---

Register the `/consent` page so the DDISA `allowlist-user` flow can render its consent screen. Without this the page-route wasn't extended and the SP redirect from `/authorize` hit a 404.
