---
'@openape/core': minor
'@openape/nuxt-auth-idp': patch
---

Two small admin/DX additions:

- **`@openape/core`**: new `clearDNSCacheFor(domain)` helper alongside the existing `clearDNSCache()`. Lets a domain owner drop the IdP's in-memory cache for their domain right after they update their `_ddisa.{domain}` TXT record, without waiting for the 300s positive TTL.
- **`@openape/nuxt-auth-idp`**: the `decision === 'deny'` redirect for the bearer flow + the "back to SP" button on the `/denied` page now include an OAuth-spec `error_description` parameter alongside the bare `error=access_denied`. SPs can use this to render product-specific guidance instead of just the bare error code (`mode=deny` → "Domain owner forbids this IdP", `allowlist-admin` deny → "SP not on the admin-curated allowlist").
