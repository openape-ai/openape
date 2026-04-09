# Changelog

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
