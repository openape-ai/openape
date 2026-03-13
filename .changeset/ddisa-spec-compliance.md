---
"@openape/core": patch
"@openape/nuxt-auth-idp": minor
---

Align implementation with DDISA spec v1.0-draft

**@openape/core:**
- Fix error status codes: `invalid_audience`/`invalid_nonce` → 401, `grant_not_approved` → 400, `grant_already_used` → 410
- Add missing error types: `policyDenied`, `invalidPkce`, `invalidState`
- Update JSDoc from ES256 to EdDSA

**@openape/nuxt-auth-idp:**
- Fix `ddisa_version` from `'ddisa1'` to `'1.0'`
- Fix `ddisa_auth_methods_supported` from `'passkey'` to `'webauthn'`
- Grant/Delegation create now returns HTTP 201
- Batch endpoint: `body.actions` → `body.operations`, response includes `success` boolean
- Delegation validate returns `{ valid, delegation, scopes }` instead of ProblemDetails
- **BREAKING:** `authzJWT` → `authz_jwt` in approve/token API responses (snake_case per OAuth2)
- Delegation list supports `?role=delegator|delegate` query parameter
