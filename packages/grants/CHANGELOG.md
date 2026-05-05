# Changelog

## 0.11.5

### Patch Changes

- Updated dependencies [[`362390c`](https://github.com/openape-ai/openape/commit/362390c6da33bb6334ac22830336b5e4903e157c)]:
  - @openape/core@0.16.0

## 0.11.4

### Patch Changes

- Updated dependencies [[`38c5c3c`](https://github.com/openape-ai/openape/commit/38c5c3cf1c2a4b11c4942e4e9eee6ddcec2deff9)]:
  - @openape/core@0.15.0

## 0.11.3

### Patch Changes

- Updated dependencies [[`146a5a3`](https://github.com/openape-ai/openape/commit/146a5a3dd3960b42c7f40a0ece0f7c361934c323)]:
  - @openape/core@0.14.0

## 0.11.2

### Patch Changes

- Updated dependencies [[`d7f78fa`](https://github.com/openape-ai/openape/commit/d7f78fa68478f295202351e15bfada8ce849c4db)]:
  - @openape/core@0.13.2

## 0.11.1

### Patch Changes

- Updated dependencies [[`ed1ad3f`](https://github.com/openape-ai/openape/commit/ed1ad3f6cd7d8ed2c9309cabda503d3ecf6453ff)]:
  - @openape/core@0.13.1

## 0.11.0

### Minor Changes

- [#131](https://github.com/openape-ai/openape/pull/131) [`d1c8f5a`](https://github.com/openape-ai/openape/commit/d1c8f5a711b088ac160c92d67a532f6f4d77d437) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase 5: glob-pattern support in coverage + mobile-first scoped-command authoring.

  - `cliAuthorizationDetailCovers` now treats `*` inside granted selector values as glob wildcards (prefix/suffix/middle, POSIX-shell semantics — `*` matches any chars including `/`). Selectors without `*` stay literal equality. Backward-compatible: all existing standing grants match identically.
  - New `selectorValueMatches(granted, required)` helper exported from `@openape/grants`.
  - Free-idp UI: full-screen 3-step wizard on `/agents/:id` lets users author scoped standing grants by typing an example command, editing typed slots with Literal/Any/Pattern modes (live glob preview), and picking risk cap / duration / reason.
  - The previous "Safe Commands" grid and "Scoped Standing Grants" list are merged into a single "Erlaubte Commands" card on the agent detail page; defaults keep their shield-check icon + inline toggle.
  - `@openape/idp-test-suite` adds an E2E glob-coverage scenario under `suites/safe-commands.ts` that seeds a prefix-globbed path SG and asserts covered vs. uncovered requests.

## 0.10.0

### Minor Changes

- [#127](https://github.com/openape-ai/openape/pull/127) [`d8e1516`](https://github.com/openape-ai/openape/commit/d8e15161d7edda67139633ec18c959a2cc8a57bd) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase 4: Safe-Commands seeding + UX.

  - Agent enrollment now auto-seeds 14 default safe-command standing grants for the new agent (ls, cat, head, tail, wc, file, stat, which, echo, date, whoami, pwd, find, grep). Low-risk read-only invocations of those CLIs auto-approve without a prompt.
  - New UI section on `/agents/:email` to toggle defaults and add custom safe commands.
  - New `/agents` page modal to bulk-apply safe commands across all of a user's agents (idempotent — already-present entries are skipped).
  - New endpoint `POST /api/standing-grants/bulk-seed` for the bulk-apply flow.
  - Recent-activity table on `/agents/:email` now shows a distinct "Safe cmd" badge for auto-approvals traced to a safe-command standing grant.

  Existing agents are not retroactively modified; use the bulk-apply modal to opt in.

## 0.9.0

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

## 0.8.0

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

## 0.7.0

### Minor Changes

- Add CLI permission engine (moved from @openape/core): `canonicalizeCliPermission`, `widenCliAuthorizationDetail`, `mergeCliAuthorizationDetails`, `cliAuthorizationDetailCovers`, `cliAuthorizationDetailsCover`, `cliAuthorizationDetailIsSimilar`, `validateCliAuthorizationDetail`, `isCliAuthorizationDetailExact`, `computeArgvHash`. Remove unreachable dead code branch in `mergeCliAuthorizationDetails`.

### Patch Changes

- Updated dependencies []:
  - @openape/core@0.12.0

## 0.6.0

### Minor Changes

- feat: incremental capability grants — extend existing grants with new requests

### Patch Changes

- Updated dependencies []:
  - @openape/core@0.11.0

## 0.5.3

### Patch Changes

- Updated dependencies [[`da8a5ac`](https://github.com/openape-ai/openape/commit/da8a5acf82542810ecddf4ad7a9ac8b7b1cfd287)]:
  - @openape/core@0.10.0

## 0.5.2

### Patch Changes

- [`bd1eb0d`](https://github.com/openape-ai/openape/commit/bd1eb0d83f700f1c289d21a545d3d62ced7f44d6) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Add CLI authorization types (OpenApeCliAuthorizationDetail, OpenApeCliResourceRef, OpenApeExecutionContext), validation functions (canonicalizeCliPermission, cliAuthorizationDetailCovers, computeArgvHash), and export them from @openape/core

- Updated dependencies [[`bd1eb0d`](https://github.com/openape-ai/openape/commit/bd1eb0d83f700f1c289d21a545d3d62ced7f44d6)]:
  - @openape/core@0.8.0

## 0.5.1

### Patch Changes

- Fix: token endpoint now rejects expired timed grants via introspectGrant, defensive exp check in issueAuthzJWT

- Relicense from AGPL-3.0-or-later to MIT, rename OpenAPE to OpenApe

- Updated dependencies []:
  - @openape/core@0.7.1

## 0.5.0

### Minor Changes

- feat: grant approval type selector and grant reuse

  Approvers can now choose the grant type (once/timed/always) when approving a grant, with duration picker for timed grants. Active timed/always grants with matching parameters are automatically reused instead of creating new pending grants. The grant_type field in OpenApeGrantRequest is now optional, defaulting to 'once'.

### Patch Changes

- Updated dependencies []:
  - @openape/core@0.7.0

## 0.4.0

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
