---
'@openape/core': minor
'@openape/grants': minor
'@openape/nuxt-auth-idp': minor
'@openape/apes': minor
---

Let a requester withdraw its own referenced single-use request, also through
the grant broker. The new terminal status `withdrawn` cannot be approved,
consumed or renewed, leaves batch review and pending limits, and records an
optional reason. apes treats it as a refusal.
