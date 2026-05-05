# Changelog

## 0.9.1

### Patch Changes

- [#309](https://github.com/openape-ai/openape/pull/309) [`779d8ae`](https://github.com/openape-ai/openape/commit/779d8ae64d00fb7ffaff89275c7c53df51308174) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Security hardening of the SP-metadata consent flow. SP-controlled fields fetched from `/.well-known/oauth-client-metadata` are rendered by the IdP's consent UI; without sanitization a malicious SP could ship `javascript:` URIs in `policy_uri` / `tos_uri` and turn the IdP origin into an XSS sandbox at click time.

  - `@openape/auth`: `createClientMetadataResolver` now normalizes every fetched (and operator-supplied) metadata document. URL fields (`logo_uri`, `policy_uri`, `tos_uri`, `client_uri`, `jwks_uri`) must parse as `http(s):` — anything else (`javascript:`, `data:`, `vbscript:`, …) is silently dropped. Display strings are length-capped (200 chars for names, 2000 for URLs).
  - `@openape/nuxt-auth-idp`: the reference consent page and account-connections list no longer forward or render `logo_uri`. SP-supplied images are an unsanitisable surface (browser image-parser CVEs, fingerprinting, brand-spoofing) — deployers who want logos must override the page with their own UI.

## 0.9.0

### Minor Changes

- [`2e753fd`](https://github.com/openape-ai/openape/commit/2e753fda9e7beaf1cec20077fbe2576a52c1c1df) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Connected services UI — list & revoke approved SPs (#301 follow-up).

  Users running in DDISA `mode=allowlist-user` need to be able to walk back a previous consent. Without that, the consent screen was a one-way door.

  - **`@openape/auth.ConsentStore`**: extended with `list(userId)` and `revoke(userId, clientId)`. `InMemoryConsentStore` gets the implementations + 4 unit tests pinning sort-order, scoping, and idempotent revoke.
  - **`@openape/nuxt-auth-idp`**:
    - `defineConsentStore` factory + auto-imported `createConsentStore` (unstorage default for module/playground/tests).
    - `GET /api/account/consents` returns the approved SPs enriched with metadata (name + logo + verified flag); `DELETE /api/account/consents/:clientId` revokes.
    - Account page (`/account`) gains a "Connected Services" card with the list + Widerrufen button per row. Verified SPs render their name/logo; unverified ones show the bare `client_id` plus an `unverifiziert` badge.
  - **`apps/openape-free-idp`**: `consents` table in the schema (composite PK on `(user_email, client_id)`, `granted_at` integer), Drizzle store (`createDrizzleConsentStore`) wired through `defineConsentStore` in the idp-stores plugin. The `02.database.ts` boot plugin's `CREATE TABLE IF NOT EXISTS` is the migration path for live DBs.

  Revoking sends the user back through the consent screen on the next /authorize against that SP, including unverified-warning UI if the SP didn't publish metadata.

## 0.8.1

### Patch Changes

- [#302](https://github.com/openape-ai/openape/pull/302) [`788a945`](https://github.com/openape-ai/openape/commit/788a9459170ec03427422c6d3d0f3daa5f266712) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Implement DDISA `allowlist-user` policy mode (consent screen) per core.md §2.3 (closes #301).

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

## 0.8.0

### Minor Changes

- [#300](https://github.com/openape-ai/openape/pull/300) [`f787da5`](https://github.com/openape-ai/openape/commit/f787da57a04e3f5ea57395c16278f24fd89c5ebc) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Enforce DDISA `core.md §5.2.1` `redirect_uri` validation against SP-published metadata (closes #280).

  The IdP previously accepted any `redirect_uri` on `/authorize` — only `client_id` was checked for presence. The DDISA spec mandates: SPs MUST publish `/.well-known/oauth-client-metadata` (RFC 7591), and the IdP MUST verify `redirect_uri` against the SP's `redirect_uris` array.

  This isn't a centralised registry — it's the same DNS/HTTP-discoverable pattern DDISA uses for IdPs. SP is source-of-truth for its own callbacks; IdP fetches and validates.

  Implementation:

  - **`@openape/auth`**: new `createClientMetadataResolver()` fetches and caches SP metadata (300s TTL, parallel to DDISA DNS cache). Falls back to legacy `/.well-known/sp-manifest.json` per the spec's migration note. New `validateRedirectUri()` does strict-equality matching (no path-prefix, no wildcards — RFC 6749 §3.1.2.2 + OAuth 2.0 Security BCP).
  - **`@openape/nuxt-auth-idp`**: `/authorize` calls the resolver before issuing a code; rejects with 400 on mismatch.

  **Rollout-safe defaults**:

  - `spMetadataMode: 'permissive'` (default) tolerates unresolvable SP metadata so existing SPs keep working while they catch up. Explicit redirect_uri MISMATCH is always rejected though — permissive only forgives missing metadata.
  - `spMetadataMode: 'strict'` once all SPs publish: also rejects unresolvable.
  - Native CLIs (RFC 8252 public clients) without a domain go through a static `publicClients` map — `apes-cli` registered for the `localhost:9876` callback.

  Env vars: `NUXT_OPENAPE_IDP_SP_METADATA_MODE`, `NUXT_OPENAPE_IDP_PUBLIC_CLIENTS` (JSON).

  Follow-up: each OpenApe SP (chat, plans, tasks, preview) needs to publish its `oauth-client-metadata` file before strict mode can be enabled. Tracked separately.

## 0.7.2

### Patch Changes

- [`8271991`](https://github.com/openape-ai/openape/commit/8271991f42d18a32b8dfd4e7306f6dd294d3a286) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Bundle of free-idp hardening fixes from the 2026-05-04 audit (closes #292, #293, #294, #295, #296).

  - **#292**: extend `RE_AUTH_PATHS` rate-limit regex to cover `/api/{enroll,register,my-agents,push,users}` — paths that were uncapped for brute-force attacks.
  - **#293**: defence-in-depth in `apps/openape-free-idp/server/api/test/session.post.ts` — additional `NODE_ENV !== 'production'` gate, plus `crypto.timingSafeEqual` instead of `!==` on the management-token compare.
  - **#294**: `enroll.post.ts` derives agent emails with an 8-hex-char hash of the canonical owner email, eliminating the dot-collapse / sanitise collisions where `foo@example.com` and `foo@example_com` mapped to the same agent suffix.
  - **#295**: `my-agents/[id].patch.ts` now validates the new SSH key BEFORE deleting old ones, then saves and prunes — agent is never without an authenticator on validation failure. Plus 1000-char length cap and explicit-shape check on the public key. `SshKeyStore.deleteAllForUser` gains an `exceptKeyId` option for the rotate-in-place flow; backwards-compatible (option is optional).
  - **#296**: `push/subscribe.post.ts` rejects with 409 when the endpoint URL is already registered to a different account, and removes `userEmail` from the conflict-update SET clause. Closes the subscription-hijack path.

## 0.7.1

### Patch Changes

- Updated dependencies [[`146a5a3`](https://github.com/openape-ai/openape/commit/146a5a3dd3960b42c7f40a0ece0f7c361934c323)]:
  - @openape/core@0.14.0

## 0.7.0

### Minor Changes

- [`cbcffc7`](https://github.com/openape-ai/openape/commit/cbcffc74d7fe08520c1a18f2d546181446c1cfca) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix refresh-token cross-audience forgery (closes #274).

  `handleRefreshGrant` accepted a user-supplied `client_id` and passed it straight into `issueAssertion({ aud: clientId })` without verifying it matched the client the token was originally issued to. A refresh token captured for SP-A could therefore be redeemed at the IdP token endpoint with `client_id=SP-B` to mint a fresh assertion with `aud=SP-B` — RFC 6749 §6 audience binding broken.

  The handler now compares the request's `client_id` against the `clientId` returned from `RefreshTokenStore.consume` and throws a new `RefreshClientMismatchError` (also exported from the package) on mismatch. The IdP's `/token` route already maps any error from `handleRefreshGrant` to `400 invalid_grant`, so no route changes were needed.

## 0.6.3

### Patch Changes

- Updated dependencies [[`d7f78fa`](https://github.com/openape-ai/openape/commit/d7f78fa68478f295202351e15bfada8ce849c4db)]:
  - @openape/core@0.13.2

## 0.6.2

### Patch Changes

- Updated dependencies [[`ed1ad3f`](https://github.com/openape-ai/openape/commit/ed1ad3f6cd7d8ed2c9309cabda503d3ecf6453ff)]:
  - @openape/core@0.13.1

## 0.6.1

### Patch Changes

- Updated dependencies [[`03edf70`](https://github.com/openape-ai/openape/commit/03edf70c9aa73a362cc3376d3a8f8e041620d054)]:
  - @openape/core@0.13.0

## 0.6.0

### Minor Changes

- Add unified User/SshKey/GrantChallengeStore interfaces and in-memory implementations. The User interface replaces the separate User + Agent model — an agent is a User with `owner` set. New exports: `User`, `UserStore`, `InMemoryUserStore`, `SshKey`, `SshKeyStore`, `InMemorySshKeyStore`, `GrantChallengeStore`, `InMemoryGrantChallengeStore`.

### Patch Changes

- Updated dependencies []:
  - @openape/core@0.12.0

## 0.5.7

### Patch Changes

- Updated dependencies []:
  - @openape/core@0.11.0

## 0.5.6

### Patch Changes

- Updated dependencies [[`da8a5ac`](https://github.com/openape-ai/openape/commit/da8a5acf82542810ecddf4ad7a9ac8b7b1cfd287)]:
  - @openape/core@0.10.0

## 0.5.5

### Patch Changes

- Updated dependencies [[`bd1eb0d`](https://github.com/openape-ai/openape/commit/bd1eb0d83f700f1c289d21a545d3d62ced7f44d6)]:
  - @openape/core@0.8.0

## 0.5.4

### Patch Changes

- Relicense from AGPL-3.0-or-later to MIT, rename OpenAPE to OpenApe

- Updated dependencies []:
  - @openape/core@0.7.1

## 0.5.3

### Patch Changes

- Updated dependencies []:
  - @openape/core@0.7.0

## 0.5.2

### Patch Changes

- Updated dependencies [[`3f0a62f`](https://github.com/openape-ai/openape/commit/3f0a62f25b07623d13f4e450683133415807358f)]:
  - @openape/core@0.6.0

## 0.5.1

### Patch Changes

- fix: correct @openape/core dependency (was ^0.4.0 with ES256, needs ^0.5.0 for EdDSA)
