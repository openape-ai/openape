---
"@openape/core": minor
"@openape/nuxt-auth-sp": patch
"@openape/agent-runtime": patch
---

Consolidate the SSRF guard (isBlockedAddress + assertPublicUrl) into @openape/core as the single source of truth; nuxt-auth-sp and agent-runtime now consume it. No behaviour change.
