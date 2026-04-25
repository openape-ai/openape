# Changelog

## 0.13.2

### Patch Changes

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

## 0.13.1

### Patch Changes

- [#151](https://github.com/openape-ai/openape/pull/151) [`ed1ad3f`](https://github.com/openape-ai/openape/commit/ed1ad3f6cd7d8ed2c9309cabda503d3ecf6453ff) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - YOLO-Modus: per-Agent Opt-in Auto-Approval für Grant-Requests.

  - Neuer Abschnitt auf `/agents/:email` zum (De)Aktivieren plus Deny-Patterns (Glob: `*`/`?`) und optionale Risiko-Schwelle.
  - Admin-API: `GET|PUT|DELETE /api/users/:email/yolo-policy` (Session-Auth + Owner/Approver/Admin-Check).
  - Server-seitige Auto-Approval läuft nach dem Standing-Grant-Match; zuerst erfolgreicher Matcher gewinnt. Deny-Patterns und Risk-Threshold (Shape-Resolver, generic fallback → `risk='high'`) rollen den Request auf den normalen manuellen Flow zurück.
  - Audit-Marker: neue Spalte `grants.auto_approval_kind` (`'standing' | 'yolo' | null`). Grants-UI zeigt die Herkunft als Badge.
  - Agent + CLI-Consumer (apes, grants, escapes) unverändert. JWT-Shape bleibt identisch zu human-approved Grants; nur der Datenbank-Eintrag markiert den Auto-Pfad.
  - `OpenApeGrant.auto_approval_kind` als optionales Feld im Core-Typ ergänzt.

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
