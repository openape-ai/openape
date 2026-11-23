---
"@openape/core": major
"@openape/auth": minor
"@openape/grants": minor
"@openape/nuxt-auth-idp": minor
"@openape/nuxt-auth-sp": minor
"@openape/shapes": minor
"@openape/agent-runtime": minor
---

Update `jose` to 6.2. jose 6 removed the `KeyLike` type, so key parameters and results are now typed as `CryptoKey | KeyObject`, and `importJWK`/`generateKeyPair` return Web Crypto `CryptoKey` objects instead of Node `KeyObject`s.

jose 6 is ESM-only, so the CommonJS builds of `@openape/core`, `@openape/auth`, `@openape/grants`, `@openape/shapes` and `@openape/agent-runtime` load it through `require(esm)`; their `engines.node` is now `>=22.12`, the first Node 22 release with unflagged `require(esm)`.
