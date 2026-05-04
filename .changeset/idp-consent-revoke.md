---
'@openape/auth': minor
'@openape/nuxt-auth-idp': minor
---

Connected services UI — list & revoke approved SPs (#301 follow-up).

Users running in DDISA `mode=allowlist-user` need to be able to walk back a previous consent. Without that, the consent screen was a one-way door.

- **`@openape/auth.ConsentStore`**: extended with `list(userId)` and `revoke(userId, clientId)`. `InMemoryConsentStore` gets the implementations + 4 unit tests pinning sort-order, scoping, and idempotent revoke.
- **`@openape/nuxt-auth-idp`**:
  - `defineConsentStore` factory + auto-imported `createConsentStore` (unstorage default for module/playground/tests).
  - `GET /api/account/consents` returns the approved SPs enriched with metadata (name + logo + verified flag); `DELETE /api/account/consents/:clientId` revokes.
  - Account page (`/account`) gains a "Connected Services" card with the list + Widerrufen button per row. Verified SPs render their name/logo; unverified ones show the bare `client_id` plus an `unverifiziert` badge.
- **`apps/openape-free-idp`**: `consents` table in the schema (composite PK on `(user_email, client_id)`, `granted_at` integer), Drizzle store (`createDrizzleConsentStore`) wired through `defineConsentStore` in the idp-stores plugin. The `02.database.ts` boot plugin's `CREATE TABLE IF NOT EXISTS` is the migration path for live DBs.

Revoking sends the user back through the consent screen on the next /authorize against that SP, including unverified-warning UI if the SP didn't publish metadata.
