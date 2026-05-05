---
'@openape/nuxt-auth-idp': patch
---

Add `id="connected-services"` anchor to the Connected Services card on `/account` so consuming apps can deep-link to the SP-revoke section. Without it the section is the fourth of five on the page and easy to miss.
