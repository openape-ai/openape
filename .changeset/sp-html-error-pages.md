---
"@openape/core": minor
"@openape/nuxt-auth-idp": patch
"@openape/nuxt-auth-sp": minor
---

SP apps now show a real error page to browsers instead of raw `application/problem+json`. The nitro `problem-details` hook ended every error response as JSON, so Nuxt never got to render `error.vue` — a human hitting a 404 was handed a JSON document.

The content negotiation that decides this (Accept q-values, `X-Requested-With`, `Sec-Fetch-Mode`) moves to `@openape/core` as `wantsHtmlErrorPage`. It already existed in `@openape/nuxt-auth-idp` and now has one home instead of two; the IdP module re-exports it, so its API is unchanged.

API clients are unaffected: anything that is not a browser navigation still receives RFC 7807 with the same status.
