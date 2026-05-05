---
'@openape/nuxt-auth-idp': patch
---

Default policy mode for missing DDISA `mode` field is now `consent` (= prompt the user), not `open`. Closes #305.

Per DDISA core.md §5.6: when the user's `_ddisa.{domain}` TXT record omits the `mode` field — or when no DDISA record exists at all — the IdP picks the default. The spec recommends prompting for consent; defaulting to `open` would silently issue assertions for any SP that asks, which is the inverse of what a missing record should mean.

**Behavior change:** users without a DDISA record now see a consent screen on first login to a new SP. SPs they've already approved (stored in the consent store) still skip the prompt. Users who explicitly want permissive behavior can publish `mode=open` in their `_ddisa.{domain}` TXT record.
