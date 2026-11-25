---
"@openape/auth": minor
"@openape/nuxt-auth-idp": minor
---

Update `@simplewebauthn/server` and `@simplewebauthn/browser` to 14. Version 14.0.2 fixes two moderate advisories in certificate revocation handling (GHSA-2g3p-m8c9-hhwh, GHSA-j3h4-m3m2-7p7j). On runtimes that support it, registration now offers ML-DSA-44 as the preferred passkey algorithm.

`@openape/auth` drops the deprecated `@simplewebauthn/types` package and imports the WebAuthn types from `@simplewebauthn/server`. Like the library, `WebAuthnCredential.transports` is now typed as `string[]`.
