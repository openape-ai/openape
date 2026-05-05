# Changelog

## 0.26.1

### Patch Changes

- [#319](https://github.com/openape-ai/openape/pull/319) [`362390c`](https://github.com/openape-ai/openape/commit/362390c6da33bb6334ac22830336b5e4903e157c) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Two small admin/DX additions:

  - **`@openape/core`**: new `clearDNSCacheFor(domain)` helper alongside the existing `clearDNSCache()`. Lets a domain owner drop the IdP's in-memory cache for their domain right after they update their `_ddisa.{domain}` TXT record, without waiting for the 300s positive TTL.
  - **`@openape/nuxt-auth-idp`**: the `decision === 'deny'` redirect for the bearer flow + the "back to SP" button on the `/denied` page now include an OAuth-spec `error_description` parameter alongside the bare `error=access_denied`. SPs can use this to render product-specific guidance instead of just the bare error code (`mode=deny` → "Domain owner forbids this IdP", `allowlist-admin` deny → "SP not on the admin-curated allowlist").

- Updated dependencies [[`362390c`](https://github.com/openape-ai/openape/commit/362390c6da33bb6334ac22830336b5e4903e157c)]:
  - @openape/core@0.16.0
  - @openape/auth@0.10.1
  - @openape/grants@0.11.5

## 0.26.0

### Minor Changes

- [#315](https://github.com/openape-ai/openape/pull/315) [`f020dcc`](https://github.com/openape-ai/openape/commit/f020dcc108602858c3cfa6957deaa97e474a3aae) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Friendly deny page for the human authorize flow. Previously a `decision === 'deny'` (from `mode=deny` or an unapproved `mode=allowlist-admin` SP) silently bounced the user back to the SP with a URL-param error they wouldn't read. Now the IdP shows `/denied` with reason-specific copy ("Der Domain-Admin hat <SP> noch nicht freigegeben", "Bitte den Admin, …") and a "back to SP" button that completes the OAuth-spec redirect (RFC 6749 §4.1.2.1). Bearer flows skip the page — agents have no UI so they get the spec-direct redirect as before.

  New routes: `/denied` (page), `GET /api/authorize/denied`, `POST /api/authorize/denied`.

## 0.25.1

### Patch Changes

- [#314](https://github.com/openape-ai/openape/pull/314) [`113e224`](https://github.com/openape-ai/openape/commit/113e22442ad04cca588ba6a185f2d22aa60c397e) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix: clicking "Anmelden" on the consent screen showed "Server did not return a redirect target." instead of completing the SP-login.

  `consent.post` previously returned a `302 sendRedirect` and the page tried to read the `Location` header from a `fetch({ redirect: 'manual' })` response. Browsers turn 3xx responses under `redirect: 'manual'` into opaque-redirect responses whose headers are unreadable per the Fetch spec — so the consent page could never get the location. Now the handler returns `{ location: '...' }` JSON and the page does a top-level `window.location.assign`. Same trust boundary; same hop sequence; just survives the Fetch spec.

## 0.25.0

### Minor Changes

- [#313](https://github.com/openape-ai/openape/pull/313) [`2b1014b`](https://github.com/openape-ai/openape/commit/2b1014bcee0b2e431e80958578a20c1bb6369baa) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - DDISA `mode=allowlist-admin` is now a real, plug-in-able feature. Closes #307.

  **`@openape/auth`** gains `AdminAllowlistStore` + `InMemoryAdminAllowlistStore`. `evaluatePolicy` accepts an optional 5th `options` arg with `adminAllowlistStore`; with no store wired up the mode keeps its previous safe-deny behaviour.

  **`@openape/nuxt-auth-idp`** wires the new store into `useIdpStores`, exposes a `defineAdminAllowlistStore(...)` registration helper, and adds two pluggable admin resolvers on `event.context`:

  - `openapeAdminResolver(event, email): boolean` — overrides the env-config email allowlist for `requireAdmin`.
  - `openapeRootAdminResolver(event, email): boolean` — strict tier for actions that must NOT be gateable by env config (e.g. operator promotion). New `requireRootAdmin` consults it; without one registered, fails closed.

  Existing apps without these hooks set keep working — `requireAdmin` falls back to the legacy `OPENAPE_ADMIN_EMAILS` env list.

### Patch Changes

- Updated dependencies [[`2b1014b`](https://github.com/openape-ai/openape/commit/2b1014bcee0b2e431e80958578a20c1bb6369baa)]:
  - @openape/auth@0.10.0

## 0.24.2

### Patch Changes

- [#310](https://github.com/openape-ai/openape/pull/310) [`f25a4e3`](https://github.com/openape-ai/openape/commit/f25a4e3dd24305597806bbc06b6dc1a10737fc7a) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Add `id="connected-services"` anchor to the Connected Services card on `/account` so consuming apps can deep-link to the SP-revoke section. Without it the section is the fourth of five on the page and easy to miss.

- [#311](https://github.com/openape-ai/openape/pull/311) [`625663b`](https://github.com/openape-ai/openape/commit/625663bf7d3e9a4028b7ebb54615755cc9bb5f32) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Default policy mode for missing DDISA `mode` field is now `consent` (= prompt the user), not `open`. Closes #305.

  Per DDISA core.md §5.6: when the user's `_ddisa.{domain}` TXT record omits the `mode` field — or when no DDISA record exists at all — the IdP picks the default. The spec recommends prompting for consent; defaulting to `open` would silently issue assertions for any SP that asks, which is the inverse of what a missing record should mean.

  **Behavior change:** users without a DDISA record now see a consent screen on first login to a new SP. SPs they've already approved (stored in the consent store) still skip the prompt. Users who explicitly want permissive behavior can publish `mode=open` in their `_ddisa.{domain}` TXT record.

- Updated dependencies [[`38c5c3c`](https://github.com/openape-ai/openape/commit/38c5c3cf1c2a4b11c4942e4e9eee6ddcec2deff9)]:
  - @openape/core@0.15.0
  - @openape/auth@0.9.2
  - @openape/grants@0.11.4

## 0.24.1

### Patch Changes

- [#309](https://github.com/openape-ai/openape/pull/309) [`779d8ae`](https://github.com/openape-ai/openape/commit/779d8ae64d00fb7ffaff89275c7c53df51308174) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Security hardening of the SP-metadata consent flow. SP-controlled fields fetched from `/.well-known/oauth-client-metadata` are rendered by the IdP's consent UI; without sanitization a malicious SP could ship `javascript:` URIs in `policy_uri` / `tos_uri` and turn the IdP origin into an XSS sandbox at click time.

  - `@openape/auth`: `createClientMetadataResolver` now normalizes every fetched (and operator-supplied) metadata document. URL fields (`logo_uri`, `policy_uri`, `tos_uri`, `client_uri`, `jwks_uri`) must parse as `http(s):` — anything else (`javascript:`, `data:`, `vbscript:`, …) is silently dropped. Display strings are length-capped (200 chars for names, 2000 for URLs).
  - `@openape/nuxt-auth-idp`: the reference consent page and account-connections list no longer forward or render `logo_uri`. SP-supplied images are an unsanitisable surface (browser image-parser CVEs, fingerprinting, brand-spoofing) — deployers who want logos must override the page with their own UI.

- [#308](https://github.com/openape-ai/openape/pull/308) [`d8fd4b3`](https://github.com/openape-ai/openape/commit/d8fd4b3a6796a566878e6dae831cdf4e806d9e54) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Register six previously-unregistered server route handlers so consuming apps actually expose them:

  - `GET /api/authorize/consent` and `POST /api/authorize/consent` (used by the `/consent` page from the `allowlist-user` flow, #301)
  - `GET /api/account/consents` and `DELETE /api/account/consents/:clientId` (self-service consent management)
  - `GET /api/admin/delegations` and `DELETE /api/admin/delegations/:id` (admin)

  The handler files existed under `runtime/server/api/` but were never wired up in the module's `addServerHandler` calls, so requests hit a 404 in production.

- [#304](https://github.com/openape-ai/openape/pull/304) [`3bb4103`](https://github.com/openape-ai/openape/commit/3bb410365a690422eaa4fdd10b1f14a681853a55) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Register the `/consent` page so the DDISA `allowlist-user` flow can render its consent screen. Without this the page-route wasn't extended and the SP redirect from `/authorize` hit a 404.

- Updated dependencies [[`779d8ae`](https://github.com/openape-ai/openape/commit/779d8ae64d00fb7ffaff89275c7c53df51308174)]:
  - @openape/auth@0.9.1

## 0.24.0

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

### Patch Changes

- Updated dependencies [[`2e753fd`](https://github.com/openape-ai/openape/commit/2e753fda9e7beaf1cec20077fbe2576a52c1c1df)]:
  - @openape/auth@0.9.0

## 0.23.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [[`788a945`](https://github.com/openape-ai/openape/commit/788a9459170ec03427422c6d3d0f3daa5f266712)]:
  - @openape/auth@0.8.1

## 0.22.0

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

### Patch Changes

- Updated dependencies [[`f787da5`](https://github.com/openape-ai/openape/commit/f787da57a04e3f5ea57395c16278f24fd89c5ebc)]:
  - @openape/auth@0.8.0

## 0.21.1

### Patch Changes

- [`8271991`](https://github.com/openape-ai/openape/commit/8271991f42d18a32b8dfd4e7306f6dd294d3a286) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Bundle of free-idp hardening fixes from the 2026-05-04 audit (closes #292, #293, #294, #295, #296).

  - **#292**: extend `RE_AUTH_PATHS` rate-limit regex to cover `/api/{enroll,register,my-agents,push,users}` — paths that were uncapped for brute-force attacks.
  - **#293**: defence-in-depth in `apps/openape-free-idp/server/api/test/session.post.ts` — additional `NODE_ENV !== 'production'` gate, plus `crypto.timingSafeEqual` instead of `!==` on the management-token compare.
  - **#294**: `enroll.post.ts` derives agent emails with an 8-hex-char hash of the canonical owner email, eliminating the dot-collapse / sanitise collisions where `foo@example.com` and `foo@example_com` mapped to the same agent suffix.
  - **#295**: `my-agents/[id].patch.ts` now validates the new SSH key BEFORE deleting old ones, then saves and prunes — agent is never without an authenticator on validation failure. Plus 1000-char length cap and explicit-shape check on the public key. `SshKeyStore.deleteAllForUser` gains an `exceptKeyId` option for the rotate-in-place flow; backwards-compatible (option is optional).
  - **#296**: `push/subscribe.post.ts` rejects with 409 when the endpoint URL is already registered to a different account, and removes `userEmail` from the conflict-update SET clause. Closes the subscription-hijack path.

- Updated dependencies [[`8271991`](https://github.com/openape-ai/openape/commit/8271991f42d18a32b8dfd4e7306f6dd294d3a286)]:
  - @openape/auth@0.7.2

## 0.21.0

### Minor Changes

- [`a5d6ad8`](https://github.com/openape-ai/openape/commit/a5d6ad8465102bcaa855523ad9bf2fdb74bb1b8b) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Close the passkey-graft account-takeover path (closes #291).

  The unauthenticated `POST /api/webauthn/register/verify` flow used to APPEND a credential to a user that already had passkeys. Anyone with read-access to the user's mailbox (transient compromise, leaked dump, recycled provider, kiosk session) could therefore mail themselves a registration token, register their own passkey, and gain permanent first-class control of the account — surviving every password-reset / recovery flow because the attacker's passkey IS itself a first-class credential.

  The verify endpoint now refuses to register a credential when the user already has at least one passkey and the request comes through the unauthenticated mail-token path. Legitimate flows continue to work:

  - **First-time enrolment** (no user yet, or user but zero credentials): unchanged — the mail token is the only trust anchor possible when no credential exists.
  - **Add a device while authenticated**: was already a separate endpoint (`POST /api/webauthn/credentials/add/verify`) that requires a fresh assertion against an existing credential.
  - **Lost-everything recovery**: tracked in #297 — 72h email-hold flow with single-token semantics + push-broadcast, separate code path.

  Four regression tests pin the gate.

## 0.20.1

### Patch Changes

- Updated dependencies [[`146a5a3`](https://github.com/openape-ai/openape/commit/146a5a3dd3960b42c7f40a0ece0f7c361934c323)]:
  - @openape/core@0.14.0
  - @openape/auth@0.7.1
  - @openape/grants@0.11.3

## 0.20.0

### Minor Changes

- [#288](https://github.com/openape-ai/openape/pull/288) [`2d17d6a`](https://github.com/openape-ai/openape/commit/2d17d6a6d5ac6dd518786bfa0403430a5cbaea90) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix rate-limit bypass via spoofed `X-Forwarded-For` header (closes #279).

  The IdP rate-limit on `/api/(session|auth|agent|webauthn)`, `/authorize`, and `/token` was keyed on `getRequestIP(event, { xForwardedFor: true })`. h3 returns the **leftmost** XFF value, which is attacker-controllable on every deployment topology that doesn't strip incoming XFF — including Vercel in many configs. Rotating the header per request let attackers slip past the 10/min cap and brute-force agent challenges, WebAuthn assertions, and enrol endpoints.

  The plugin now keys on the socket peer by default. Operators behind a real proxy fleet opt in by setting `OPENAPE_RATE_LIMIT_TRUSTED_PROXIES` to a comma-separated CIDR list; when the request's direct peer is in that list the plugin walks the XFF chain right-to-left and returns the first non-trusted IP — the actual client. Attacker-injected leftmost values are now ignored.

  11 new unit tests pin CIDR matching + the right-to-left walk + the default-safe behaviour. The IPv4 CIDR matcher is small and inlined; IPv6 CIDR is a future improvement (matched literally for now).

## 0.19.3

### Patch Changes

- Updated dependencies [[`cbcffc7`](https://github.com/openape-ai/openape/commit/cbcffc74d7fe08520c1a18f2d546181446c1cfca)]:
  - @openape/auth@0.7.0

## 0.19.2

### Patch Changes

- [#285](https://github.com/openape-ai/openape/pull/285) [`83bd7f8`](https://github.com/openape-ai/openape/commit/83bd7f8c4493a24938a50563439e416eebaa62b0) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix CSRF auto-approval of `authorization_details` in `/authorize` GET (closes #273).

  The `/authorize` GET handler used to parse RFC 9396 `authorization_details` from the query string and auto-approve them server-side, treating an existing IdP session as implicit consent. A crafted URL — `<a href="https://idp/authorize?…&authorization_details=[<broad cli grant>]">` — could therefore approve sweeping grants via top-level GET navigation (cookies are `SameSite=Lax` by default), bypassing the approver-policy entirely.

  Until a proper consent UI lands, the parameter is rejected. Callers must use the explicit grant API: `POST /api/grants` to create the grant pending, then `POST /api/grants/{id}/approve` (which enforces the approver-policy fixed in PR #284). No production caller in this repo relied on the old combo — verified via grep.

## 0.19.1

### Patch Changes

- [#284](https://github.com/openape-ai/openape/pull/284) [`adfdb25`](https://github.com/openape-ai/openape/commit/adfdb254547eba81dbd937eabba8cc8c66653949) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix grant approval bypass: agents could self-approve their own grants regardless of approver policy.

  `approve.post.ts` previously had an `isRequester` short-circuit that let any caller approve a grant whose `requester === bearer.sub`. An agent armed with only its 1h IdP token could therefore mint authz_jwt for arbitrary audiences without the human owner ever being involved — defeating the entire DDISA delegation model.

  The handler now resolves the approver policy correctly per the User type convention (`approver === undefined` means "owner, or self when there is no owner"):

  - explicit approver set → only that approver (or owner) may approve
  - approver unset, owner set → owner is the implicit approver (sub-user / agent path)
  - approver unset, owner unset → top-level human, self-approval is implicit

  Surfaced in the security audit on 2026-05-04.

## 0.19.0

### Minor Changes

- [#220](https://github.com/openape-ai/openape/pull/220) [`23fa05b`](https://github.com/openape-ai/openape/commit/23fa05b5aea415330de60d622da1a61a7bb0ef17) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - apes/idp: `apes sessions list` and `apes sessions remove <id>` for self-service device management

  You can now see and revoke your own refresh-token families across devices without admin privileges:

  - `apes sessions list` — one row per `apes login` (one row per device), with familyId, clientId, createdAt, expiresAt
  - `apes sessions remove <familyId>` — revokes that specific family. The device using it fails its next token refresh with `Token family revoked` and has to `apes login` again

  Backed by two new IdP endpoints under `/api/me/sessions/…`:

  - `GET /api/me/sessions` — lists the caller's families (filtered to `userId = sub` from the authenticated session/JWT)
  - `DELETE /api/me/sessions/[familyId]` — ownership-checked: 404 if the family belongs to a different user, never 403, so users can't probe other users' familyIds

  The pre-existing admin endpoints at `/api/admin/sessions` (cross-user, requires admin role) stay as-is.

## 0.18.1

### Patch Changes

- [`5259e71`](https://github.com/openape-ai/openape/commit/5259e7151b0404d8f76a8e267f262e2841f8166c) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - idp: existing users can self-serve passkey re-registration after passkey loss

  Previously `POST /api/register` returned a silent `{ok:true}` for any email
  that already had a user record, while only sending the registration mail for
  unknown emails. The intent was email-enumeration protection. The side effect
  was that users who lost their passkey (lost device, ditched browser profile,
  or — in our case — got migrated to a new RP-domain so their existing passkey
  no longer matched) were locked out without any self-service path.

  `POST /api/register` now always issues a registration token and sends the
  mail, regardless of whether the user record exists. The verify endpoint
  (`webauthn/register/verify.post.ts`) already handled the existing-user case
  idempotently: it skips user creation and just appends the new credential.

  Email-enumeration protection is preserved at the response/timing layer —
  both unknown and known emails get the same `{ok:true}` response and the
  same mail-send latency. The mail content is identical for both, so an
  attacker who already controls the victim's mailbox can't differentiate
  "known" vs "unknown" any more easily than via any normal mail-based
  recovery flow on any other product.

  Frontend changes:

  - `useWebAuthn` composable now reads `error.data.title` (h3 ProblemDetails)
    in addition to `statusMessage`, so users see "No passkeys found for this
    email" instead of the raw FetchError string `[POST] "...": 404`.
  - Login page detects the "no passkeys" case and shows an actionable CTA
    pointing at `/register-email?email=…` to trigger the recovery flow.
  - `/register-email` pre-fills from the `?email=` query param so users
    don't retype their address.

## 0.18.0

### Minor Changes

- [#160](https://github.com/openape-ai/openape/pull/160) [`caf8d93`](https://github.com/openape-ai/openape/commit/caf8d93bd7df18b7789fca14cbe40f4242cf8e57) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - IdP-issued auth tokens now carry `aud='apes-cli'` consistently across every flow (PKCE / authorization-code, client-credentials, agent-challenge-response). Previously only the PKCE flow set an audience claim; SSH-key and challenge-response flows issued audience-less tokens, which made it impossible for downstream service providers to do scoped replay-protection on token-exchange endpoints.

  - `issueAuthToken` and `issueAgentToken` (in both `@openape/nuxt-auth-idp` and `@openape/server`) accept an optional `aud` parameter and default to `'apes-cli'`.
  - New `DEFAULT_CLI_AUDIENCE` constant exported for downstream consumers (`expectedAud`).
  - `verifyAuthToken` / `verifyAgentToken` accept an optional `expectedAud` parameter for audience-restricted verification. When omitted, audience is not checked (preserves backward compatibility with consumers that don't care).
  - Existing in-flight tokens (max 1h lifetime) are unaffected; new issuance immediately sets the audience.

  This is a precondition for the upcoming token-exchange endpoint on plans / tasks / secrets / seeds SPs that need to enforce `expectedAud='apes-cli'` to reject replays of id_tokens or delegation tokens against the exchange.

- [#156](https://github.com/openape-ai/openape/pull/156) [`d7f78fa`](https://github.com/openape-ai/openape/commit/d7f78fa68478f295202351e15bfada8ce849c4db) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Extract YOLO-mode from `@openape/nuxt-auth-idp` to `openape-free-idp`; module exposes a generic `definePreApprovalHook` seam instead.

  **Module changes (nuxt-auth-idp):**

  - **NEW** `definePreApprovalHook(hook)` + `runPreApprovalHooks(event, request)` — a generic seam apps can use to auto-approve grant requests. Hooks run AFTER standing-grant evaluation; the first non-null match wins. Return `{ kind, decidedBy }` to approve, `null` to defer to the manual flow.
  - **REMOVED** YOLO-specific files: `yolo-policy-store.ts`, `yolo-policy-auth.ts`, `grant-auto-approval.ts`, `api/users/[email]/yolo-policy.{get,put,delete}.ts`. The module is now YOLO-agnostic.
  - **REMOVED** `defineYoloPolicyStore` / `yoloPolicyStore` from the public store surface.
  - The module's runtime `/grants` page now renders `auto_approval_kind` as a generic badge (was: hardcoded YOLO/Standing match).

  **Core change:**

  - `OpenApeGrant.auto_approval_kind` widened from `'standing' | 'yolo'` to `string` so consuming apps can register custom kinds via the hook. Both previously-defined values remain valid; pure type-widen, no runtime impact.

  **Consumer migration** (applied in this PR for openape-free-idp):

  - Apps that relied on `defineYoloPolicyStore` should now register the YOLO feature in their own `server/` tree and call `definePreApprovalHook` from a Nitro plugin.

### Patch Changes

- Updated dependencies [[`d7f78fa`](https://github.com/openape-ai/openape/commit/d7f78fa68478f295202351e15bfada8ce849c4db)]:
  - @openape/core@0.13.2
  - @openape/auth@0.6.3
  - @openape/grants@0.11.2

## 0.17.0

### Minor Changes

- [#151](https://github.com/openape-ai/openape/pull/151) [`ed1ad3f`](https://github.com/openape-ai/openape/commit/ed1ad3f6cd7d8ed2c9309cabda503d3ecf6453ff) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - YOLO-Modus: per-Agent Opt-in Auto-Approval für Grant-Requests.

  - Neuer Abschnitt auf `/agents/:email` zum (De)Aktivieren plus Deny-Patterns (Glob: `*`/`?`) und optionale Risiko-Schwelle.
  - Admin-API: `GET|PUT|DELETE /api/users/:email/yolo-policy` (Session-Auth + Owner/Approver/Admin-Check).
  - Server-seitige Auto-Approval läuft nach dem Standing-Grant-Match; zuerst erfolgreicher Matcher gewinnt. Deny-Patterns und Risk-Threshold (Shape-Resolver, generic fallback → `risk='high'`) rollen den Request auf den normalen manuellen Flow zurück.
  - Audit-Marker: neue Spalte `grants.auto_approval_kind` (`'standing' | 'yolo' | null`). Grants-UI zeigt die Herkunft als Badge.
  - Agent + CLI-Consumer (apes, grants, escapes) unverändert. JWT-Shape bleibt identisch zu human-approved Grants; nur der Datenbank-Eintrag markiert den Auto-Pfad.
  - `OpenApeGrant.auto_approval_kind` als optionales Feld im Core-Typ ergänzt.

### Patch Changes

- Updated dependencies [[`ed1ad3f`](https://github.com/openape-ai/openape/commit/ed1ad3f6cd7d8ed2c9309cabda503d3ecf6453ff)]:
  - @openape/core@0.13.1
  - @openape/auth@0.6.2
  - @openape/grants@0.11.1

## 0.16.1

### Patch Changes

- Updated dependencies [[`d1c8f5a`](https://github.com/openape-ai/openape/commit/d1c8f5a711b088ac160c92d67a532f6f4d77d437)]:
  - @openape/grants@0.11.0

## 0.16.0

### Minor Changes

- [#127](https://github.com/openape-ai/openape/pull/127) [`d8e1516`](https://github.com/openape-ai/openape/commit/d8e15161d7edda67139633ec18c959a2cc8a57bd) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase 4: Safe-Commands seeding + UX.

  - Agent enrollment now auto-seeds 14 default safe-command standing grants for the new agent (ls, cat, head, tail, wc, file, stat, which, echo, date, whoami, pwd, find, grep). Low-risk read-only invocations of those CLIs auto-approve without a prompt.
  - New UI section on `/agents/:email` to toggle defaults and add custom safe commands.
  - New `/agents` page modal to bulk-apply safe commands across all of a user's agents (idempotent — already-present entries are skipped).
  - New endpoint `POST /api/standing-grants/bulk-seed` for the bulk-apply flow.
  - Recent-activity table on `/agents/:email` now shows a distinct "Safe cmd" badge for auto-approvals traced to a safe-command standing grant.

  Existing agents are not retroactively modified; use the bulk-apply modal to opt in.

### Patch Changes

- Updated dependencies [[`d8e1516`](https://github.com/openape-ai/openape/commit/d8e15161d7edda67139633ec18c959a2cc8a57bd)]:
  - @openape/grants@0.10.0

## 0.15.0

### Minor Changes

- [#125](https://github.com/openape-ai/openape/pull/125) [`5b097e9`](https://github.com/openape-ai/openape/commit/5b097e9f5a13f91f59b205298c1f412839f8facc) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase 2 of the policy shift: Web UI for agent management and
  pre-authorization.

  ## What's new

  Two new pages on `id.openape.at`:

  - **`/agents`** — list of all agents owned by the logged-in user, with
    grant-activity counters and standing-grant count.
  - **`/agents/:email`** — per-agent detail page with:
    - Existing approved standing grants (scope description + revoke action)
    - Inline form to create a new standing grant: CLI picker (populated
      from the server-side shape registry), wildcard resource-chain
      textarea (`resource:key=value` format), max-risk selector, grant
      type (always/timed), optional duration + reason.
    - Recent activity table (last 20 grants from this agent), with
      ⚡ marker on rows that were auto-approved by a standing grant.

  ## Helper utilities (new)

  - `modules/nuxt-auth-idp/src/runtime/utils/standing-grants.ts`
    - `formatStandingGrantScope(sg)` — render scope as a human string
    - `formatResourceChainTemplate(chain)` — summarise wildcards/selectors
    - `parseResourceChainInput(text)` — parse the textarea input into
      `OpenApeCliResourceRef[]`
    - `formatRelativeTime(seconds)` — "just now" / "Nm ago" / "Nh ago"

  Tests cover the parser, formatter, scope rendering, and time helper (+19 tests).

  ## Backward-compatibility

  Fully backward-compatible — pages are additive, no existing API changes.

## 0.14.0

### Minor Changes

- [#123](https://github.com/openape-ai/openape/pull/123) [`03edf70`](https://github.com/openape-ai/openape/commit/03edf70c9aa73a362cc3376d3a8f8e041620d054) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase 1 of the policy shift: server-side shape registry + standing
  grants (pre-authorization patterns) + auto-approval.

  ## What's new

  **Shape Registry (server-side):** the IdP now hosts shapes in a DB table
  (seeded from the shapes-registry repo via `pnpm seed:shapes`) and exposes
  them via three public endpoints:

  - `GET /api/shapes` — list all registered shapes
  - `GET /api/shapes/:cliId` — fetch single shape
  - `POST /api/shapes/resolve` — resolve `{cli_id, argv}` → structured
    `ServerResolvedCommand` (same shape the client `resolveCommand()`
    returns; falls back to `_generic.exec` when no shape matches)

  **Standing Grants:** users can pre-authorize a (delegate, resource-chain)
  pattern so matching future agent grant requests auto-approve without
  human intervention:

  - `POST /api/standing-grants` — create (auto-approved by creator)
  - `GET /api/standing-grants` — list own
  - `DELETE /api/standing-grants/:id` — revoke

  `POST /api/grants` now checks standing grants between reuse and
  similarity. A match creates the grant with `status='approved'`,
  `decided_by = <standing-grant owner>`, and `decided_by_standing_grant =
<id>` for audit trail. The response includes `approved_automatically:
true` so clients can distinguish auto-approved from manually-approved
  grants.

  **Agent View:** `GET /api/users/:email/agents` returns per-agent
  standing grants + recent activity + status counts (for the Phase 2 UI).

  ## Public surface

  **`@openape/grants`** — new exports:

  - `ServerShape`, `ServerShapeOperation`, `ShapeStore`,
    `createInMemoryShapeStore`
  - `resolveServerShape`, `ServerResolvedCommand`, `GENERIC_OPERATION_ID`
  - `StandingGrantRequest`, `StandingGrantMatch`,
    `evaluateStandingGrants`, `isStandingGrantRequest`,
    `buildCoverageDetailFromStandingGrant`

  **`@openape/core`** — extensions:

  - `GrantCategory` now includes `'standing'`
  - `OpenApeGrant.decided_by_standing_grant` audit column

  **`@openape/nuxt-auth-idp`** — new `defineShapeStore()` for registering
  a production ShapeStore (drizzle-backed in openape-free-idp).

  ## Backward compatibility

  Phase 1 is fully backward-compatible — existing `apes` CLI installations
  continue to work unchanged. Phase 3 (apes CLI cutover) is the breaking
  change; Phase 1+2 build the foundation without touching the client.

### Patch Changes

- Updated dependencies [[`03edf70`](https://github.com/openape-ai/openape/commit/03edf70c9aa73a362cc3376d3a8f8e041620d054)]:
  - @openape/core@0.13.0
  - @openape/grants@0.9.0
  - @openape/auth@0.6.1

## 0.13.1

### Patch Changes

- [#120](https://github.com/openape-ai/openape/pull/120) [`b7e9aea`](https://github.com/openape-ai/openape/commit/b7e9aea4a22f6cc601b3822039e3a2fc3aaac06e) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Add generic-fallback mode for `apes run -- <cli>` when the CLI has no
  registered shape.

  **Before:** `apes run -- kubectl get pods` hard-failed with
  `"No adapter found for kubectl"` unless a full `kubectl.toml` shape was
  written first.

  **After:** `apes run -- kubectl get pods` creates a synthetic adapter
  in-memory, requests a single-use grant with `risk=high` and
  `exact_command=true`, and runs the command once approved. An stderr
  warning makes the fallback explicit:

  ```
  ⚠ No shape registered for `kubectl`.
  Generic mode active — single-use grant will be required.
  ```

  **Safety layers:**

  - Forced `risk: "high"` on every generic grant
  - Forced `exact_command: true` — grant is bound to the exact argv hash
  - Single-use by default (enforced by IdP `usedAt` timestamp)
  - `~/.config/apes/generic-calls.log` captures every successful generic
    execution as JSONL for later shape promotion
  - Free-IdP approval page shows a prominent "⚠ Unshaped CLI" banner

  **Opt-out:** `[generic] enabled = false` in `~/.config/apes/config.toml`
  restores the legacy hard-fail behaviour.

  **Compatibility:**

  - Existing shapes are unaffected — generic-fallback only activates when
    `loadAdapter()` throws "No adapter found".
  - The synthetic path bypasses `resolveCommand()` entirely and feeds a
    pre-built `ResolvedCommand` into the grant pipeline. Parser remains
    unchanged.
  - The audit-log hook sits in `verifyAndExecute`, covering sync (`--wait`),
    async-default (`apes run` → `apes grants run <id> --wait`), and REPL
    one-shot paths with one implementation.
  - `apes run --as <user>` (escapes) and `ape-shell` one-shot session-grant
    behaviour are unchanged.

  **New public surface (`@openape/apes`):**

  - `shapes/generic.ts`: `buildGenericAdapter`, `buildGenericResolved`,
    `isGenericResolved`, `GENERIC_OPERATION_ID`
  - `shapes/adapters.ts`: `resolveGenericOrReject`
  - `audit/generic-log.ts`: `appendGenericCallLog`, `defaultGenericLogPath`
  - `config.ts`: `isGenericFallbackEnabled`, `getGenericAuditLogPath`,
    `ApesConfig.generic`

## 0.13.0

### Minor Changes

- [#48](https://github.com/openape-ai/openape/pull/48) [`6c0cbad`](https://github.com/openape-ai/openape/commit/6c0cbada5165dc4e45381ffdaca847cd9dfc1d02) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Add proactive widening suggestions to grant approval.

  When a user approves a pending structured CLI grant for the first time, the IdP now
  pre-computes a list of scope options derived from the request (exact, sibling-type,
  directory, subtree, wildcard) and presents them as radio buttons in the approval UI.
  The approver can choose how broad the grant should be in a single click instead of
  needing a second request to trigger the widen flow.

  - `@openape/grants` adds `suggestWideningsForDetail`, `buildWideningSuggestionsForGrant`,
    and `approveGrantWithWidening` with server-side validation (structural match +
    coverage) that rejects any client-forged "widening" that would be a different grant.
  - `@openape/nuxt-auth-idp` attaches `widening_suggestions` to pending CLI grants in
    `GET /api/grants/[id]` and accepts an optional `widened_details` body parameter in
    `POST /api/grants/[id]/approve` (mutually exclusive with `extend_mode`).
  - `@openape/vue-components` and the nuxt-auth-idp `grant-approval.vue` page render
    the scope radio group when no similar grants exist. Conservative default: exact.

### Patch Changes

- Updated dependencies [[`6c0cbad`](https://github.com/openape-ai/openape/commit/6c0cbada5165dc4e45381ffdaca847cd9dfc1d02)]:
  - @openape/grants@0.8.0

## 0.12.0

### Minor Changes

- Add SSH key store and unified auth endpoints (`/api/auth/challenge`, `/api/auth/authenticate`), generalized token system supporting both `act: 'agent'` and `act: 'human'`, admin SSH key management endpoints, 'As requested' option in grant approval UI, Bearer token support in delegations endpoints. Add Drizzle SSH key store for Free-IdP. Update OIDC Discovery with new auth endpoints.

### Patch Changes

- Updated dependencies []:
  - @openape/auth@0.6.0
  - @openape/core@0.12.0
  - @openape/grants@0.7.0

## 0.11.0

### Minor Changes

- feat: incremental capability grants — extend existing grants with new requests

### Patch Changes

- Updated dependencies []:
  - @openape/core@0.11.0
  - @openape/grants@0.6.0
  - @openape/auth@0.5.7

## 0.10.1

### Patch Changes

- Updated dependencies [[`da8a5ac`](https://github.com/openape-ai/openape/commit/da8a5acf82542810ecddf4ad7a9ac8b7b1cfd287)]:
  - @openape/core@0.10.0
  - @openape/auth@0.5.6
  - @openape/grants@0.5.3

## 0.10.0

### Minor Changes

- [`deee941`](https://github.com/openape-ai/openape/commit/deee941887ef584ae43f0680c27c1464ef95b7c4) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - feat: add defineXxxStore pattern for custom storage backends

  All 11 stores (grants, challenges, users, agents, credentials, etc.) are now replaceable via Nitro plugins. Apps can register custom store implementations using `defineGrantStore()`, `defineUserStore()`, etc. The default Unstorage-based implementation remains — no changes needed for existing apps.

## 0.8.2

### Patch Changes

- Updated dependencies [[`bd1eb0d`](https://github.com/openape-ai/openape/commit/bd1eb0d83f700f1c289d21a545d3d62ced7f44d6)]:
  - @openape/core@0.8.0
  - @openape/grants@0.5.2
  - @openape/auth@0.5.5

## 0.8.1

### Patch Changes

- Fix: token endpoint now rejects expired timed grants via introspectGrant, defensive exp check in issueAuthzJWT

- Relicense from AGPL-3.0-or-later to MIT, rename OpenAPE to OpenApe

- Updated dependencies []:
  - @openape/grants@0.5.1
  - @openape/core@0.7.1
  - @openape/auth@0.5.4

## 0.8.0

### Minor Changes

- feat: grant approval type selector and grant reuse

  Approvers can now choose the grant type (once/timed/always) when approving a grant, with duration picker for timed grants. Active timed/always grants with matching parameters are automatically reused instead of creating new pending grants. The grant_type field in OpenApeGrantRequest is now optional, defaulting to 'once'.

### Patch Changes

- Updated dependencies []:
  - @openape/core@0.7.0
  - @openape/grants@0.5.0
  - @openape/auth@0.5.3

## 0.7.3

### Patch Changes

- Security: grant approve/deny now requires agent owner or approver (admin bypass removed). Grant list restricted to own agents for all users.

## 0.7.2

### Patch Changes

- Restrict grant visibility: only show grants from user's own/approved agents (not all pending grants to all users).

## 0.7.1

### Patch Changes

- Token endpoint accepts both agent and session auth. grapes shows clean error messages by default (use --debug for stack traces).

## 0.7.0

### Minor Changes

- [#1](https://github.com/openape-ai/openape/pull/1) [`3f0a62f`](https://github.com/openape-ai/openape/commit/3f0a62f25b07623d13f4e450683133415807358f) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Align implementation with DDISA spec v1.0-draft

  **@openape/core:**

  - **BREAKING:** `OpenApeGrantRequest.target` → `target_host` (host/domain), `audience` now REQUIRED
  - `OpenApeAuthZClaims` gets `target_host` as REQUIRED claim
  - Fix error status codes: `invalid_audience`/`invalid_nonce` → 401, `grant_not_approved` → 400, `grant_already_used` → 410
  - Add missing error types: `policyDenied`, `invalidPkce`, `invalidState`

  **@openape/grants:**

  - **BREAKING:** `issueAuthzJWT` sets `aud` from `audience` (not `target`), adds `target_host` + `run_as` claims

  **@openape/nuxt-auth-idp:**

  - Grant creation validates `target_host` + `audience` (REQUIRED)
  - Fix `ddisa_version` from `'ddisa1'` to `'1.0'`
  - Fix `ddisa_auth_methods_supported` from `'passkey'` to `'webauthn'`
  - Grant/Delegation create now returns HTTP 201
  - Batch endpoint: `body.actions` → `body.operations`, response includes `success` boolean
  - Delegation validate returns `{ valid, delegation, scopes }` instead of ProblemDetails
  - **BREAKING:** `authzJWT` → `authz_jwt` in approve/token API responses (snake_case per OAuth2)
  - Delegation list supports `?role=delegator|delegate` query parameter

  **@openape/grapes:**

  - **BREAKING:** Replace `exec` command with audience-first `run` command
  - `request` command uses `--audience` + `--host` instead of `--for`
  - Remove `defaults.for` from config

  **@openape/proxy:**

  - Update `GrantsClient` to use `targetHost` + `audience` parameters

### Patch Changes

- Updated dependencies [[`3f0a62f`](https://github.com/openape-ai/openape/commit/3f0a62f25b07623d13f4e450683133415807358f)]:
  - @openape/core@0.6.0
  - @openape/grants@0.4.0
  - @openape/auth@0.5.2

## 0.6.2

### Patch Changes

- Updated dependencies []:
  - @openape/auth@0.5.1

## 0.6.1

### Patch Changes

- Auto-rotate incompatible signing keys in IDP key store. Old ES256 keys from before the EdDSA migration are now deactivated automatically instead of crashing the token exchange.
