---
"@openape/core": major
"@openape/auth": minor
"@openape/grants": minor
"@openape/nuxt-auth-idp": minor
"@openape/nuxt-auth-sp": minor
---

Update `jose` to 6.2. jose 6 removed the `KeyLike` type, so key parameters and results are now typed as `CryptoKey | KeyObject`, and `importJWK`/`generateKeyPair` return Web Crypto `CryptoKey` objects instead of Node `KeyObject`s.
