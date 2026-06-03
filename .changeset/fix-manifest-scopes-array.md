---
"@openape/nuxt-auth-sp": patch
---

Fix `openapeSp.manifest.scopes` config type to the array form (`{ id, description, grants?, ... }[]`) defined by the protocol `sp-scope-catalog.json`. The served `/.well-known/openape.json` and the cross-SP scope-catalog consumer both expect an array; the previous `Record` type contradicted the spec and would have broken cross-SP delegation consent for any SP that followed it. Runtime behaviour is unchanged (the manifest route serves `scopes` verbatim).
