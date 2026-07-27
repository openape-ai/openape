---
'@openape/nuxt-auth-sp': minor
---

Post-login default redirect is now `/` instead of `/dashboard`. The shared
constant lives in `runtime/config-defaults.ts` and is used by the module
defaults, the runtime config resolver, the OIDC callback and
`OpenApeAuth.vue`. SPs with a dedicated landing page set
`openapeSp.postLoginRedirect` explicitly.
