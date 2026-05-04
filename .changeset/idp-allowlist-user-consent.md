---
'@openape/nuxt-auth-idp': minor
'@openape/auth': patch
---

Implement DDISA `allowlist-user` policy mode (consent screen) per core.md §2.3 (closes #301).

Previously: `evaluatePolicy` had the right logic for `allowlist-user`, but `authorize.get.ts` treated `decision === 'consent'` as an error (`access_denied` redirect) and used a `noopConsentStore` that always returned `hasConsent: false`. Net effect: any user with `mode=allowlist-user` in their `_ddisa.{domain}` TXT record was permanently locked out.

Now:

- **Real `ConsentStore`** backed by unstorage (default) with the same shape as `@openape/auth`'s in-memory implementation. Free-idp can swap in a Drizzle-backed version via the existing store-registry.
- **`authorize.get.ts` routing fixed**: `'deny'` still produces `access_denied`; `'consent'` stashes the original /authorize state in the user's session under `pendingConsent` (with a one-shot CSRF token) and redirects to `/consent`.
- **`/consent` page** (Vue) renders metadata-aware UI:
  - SP that publishes `/.well-known/oauth-client-metadata` → "verified" tone with name + logo + policy/tos links
  - SP that publishes nothing → "unverified" tone with explicit warning + de-emphasised primary action
- **`POST /api/authorize/consent`** validates CSRF token, persists consent (so subsequent /authorize calls skip the screen), drops the pending state from the session, and resumes the original /authorize flow.
- **Cancel** redirects the user to the SP's `redirect_uri` with `error=access_denied`.
- **TTL guard**: pending consent state expires after 5 min so a stale token can't be replayed across sessions.

Mode is **per-user-DNS**, not a global IdP toggle. Users opt in by setting their `_ddisa.{domain}` TXT record to `mode=allowlist-user`. Users who keep `mode=open` (or no TXT) see no consent screen — current behaviour preserved.

Adds optional RFC 7591 fields (`client_uri`, `logo_uri`, `policy_uri`, `tos_uri`, `contacts`) to `ClientMetadata` so the consent UI can render them.
