# Changelog

## 0.13.0

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

## 0.12.0

### Minor Changes

- Remove dead code (password hashing, unused validation functions), move CLI permission engine to @openape/grants, replace runtime detection with node-first DoH fallback, remove redundant exp check in assertion validation.

  BREAKING: `hashPassword`, `verifyPassword`, `validateClientMetadata`, `fetchAndValidateClientMetadata`, `fetchAndValidateOpenApeManifest`, `detectRuntime`, `Runtime` exports removed. CLI permission functions (`canonicalizeCliPermission`, `widenCliAuthorizationDetail`, etc.) moved to `@openape/grants`. `AssertionValidationOptions.now` parameter removed.

## 0.11.0

### Minor Changes

- feat: incremental capability grants — extend existing grants with new requests

## 0.10.0

### Minor Changes

- [#14](https://github.com/openape-ai/openape/pull/14) [`da8a5ac`](https://github.com/openape-ai/openape/commit/da8a5acf82542810ecddf4ad7a9ac8b7b1cfd287) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Support wildcard resource matching for capability grants. A shorter granted resource chain now covers longer required chains (prefix matching), and `apes run` checks for existing capability grants before creating new exact-command grants.

## 0.8.0

### Minor Changes

- [`bd1eb0d`](https://github.com/openape-ai/openape/commit/bd1eb0d83f700f1c289d21a545d3d62ced7f44d6) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Add CLI authorization types (OpenApeCliAuthorizationDetail, OpenApeCliResourceRef, OpenApeExecutionContext), validation functions (canonicalizeCliPermission, cliAuthorizationDetailCovers, computeArgvHash), and export them from @openape/core

## 0.7.1

### Patch Changes

- Relicense from AGPL-3.0-or-later to MIT, rename OpenAPE to OpenApe

## 0.7.0

### Minor Changes

- feat: grant approval type selector and grant reuse

  Approvers can now choose the grant type (once/timed/always) when approving a grant, with duration picker for timed grants. Active timed/always grants with matching parameters are automatically reused instead of creating new pending grants. The grant_type field in OpenApeGrantRequest is now optional, defaulting to 'once'.

## 0.6.0

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
