---
"@openape/nuxt-auth-idp": patch
---

Type `useIdpStorage` and `useGrantStorage` from Nitro's `useStorage` instead of the undeclared `unstorage` package, so the module typechecks regardless of which `unstorage` copy is hoisted.
