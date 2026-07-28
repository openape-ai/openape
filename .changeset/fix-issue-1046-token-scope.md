---
'@openape/auth': minor
'@openape/nuxt-auth-idp': patch
'@openape/server': patch
---

Delegated assertions minted via `/token` (client_credentials + delegation_grant) now carry a `scope` claim mirroring the delegation grant's scopes (grants.md §6.1, protocol#6). `issueAssertion` accepts an optional `scope: string[]` claim; both served delegation branches (nuxt-auth-idp route and @openape/server handler) pass `grant.request.scopes ?? []` — fail-closed `[]` for legacy grants without scopes. First-party client_credentials tokens and the authorization_code path are unchanged (no scope claim). The never-registered `/api/oauth/token-exchange` handler in nuxt-auth-idp was removed; its scope assertions were ported to the served `/token` path.
