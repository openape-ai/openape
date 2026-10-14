---
"@openape/grants": patch
"@openape/nuxt-auth-idp": patch
---

`POST /api/grants/authorize` now refuses with 400 a program whose name matches
a desktop-own executable, and it never selects such a shape. Desktop-own
executables are the Pods runtime adapters, which `pnpm seed:shapes` marks with
`ServerShape.virtual`. A binary called `pod-runtime` can therefore no longer
borrow a Pod's runtime grant.
