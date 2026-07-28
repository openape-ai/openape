---
'@openape/nuxt-auth-idp': minor
---

Delegated access tokens minted via `/api/oauth/token-exchange` now carry a
`scope` claim mirroring the delegation grant's scopes (grants.md §6.1).
Fail-closed for legacy delegation grants without scopes: the token gets
`scope: []` ("nothing allowed"), never a missing claim — a delegated token
must always state its own limits. First-party tokens are unchanged and stay
scope-less. SPs consuming delegated tokens from legacy scope-less grants
must re-issue those grants with explicit scopes.
