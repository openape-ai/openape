# @openape/idp-test-suite

## 0.4.1

### Patch Changes

- Updated dependencies [[`ed1ad3f`](https://github.com/openape-ai/openape/commit/ed1ad3f6cd7d8ed2c9309cabda503d3ecf6453ff)]:
  - @openape/core@0.13.1

## 0.4.0

### Minor Changes

- [#131](https://github.com/openape-ai/openape/pull/131) [`d1c8f5a`](https://github.com/openape-ai/openape/commit/d1c8f5a711b088ac160c92d67a532f6f4d77d437) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase 5: glob-pattern support in coverage + mobile-first scoped-command authoring.

  - `cliAuthorizationDetailCovers` now treats `*` inside granted selector values as glob wildcards (prefix/suffix/middle, POSIX-shell semantics — `*` matches any chars including `/`). Selectors without `*` stay literal equality. Backward-compatible: all existing standing grants match identically.
  - New `selectorValueMatches(granted, required)` helper exported from `@openape/grants`.
  - Free-idp UI: full-screen 3-step wizard on `/agents/:id` lets users author scoped standing grants by typing an example command, editing typed slots with Literal/Any/Pattern modes (live glob preview), and picking risk cap / duration / reason.
  - The previous "Safe Commands" grid and "Scoped Standing Grants" list are merged into a single "Erlaubte Commands" card on the agent detail page; defaults keep their shield-check icon + inline toggle.
  - `@openape/idp-test-suite` adds an E2E glob-coverage scenario under `suites/safe-commands.ts` that seeds a prefix-globbed path SG and asserts covered vs. uncovered requests.

## 0.3.0

### Minor Changes

- [#127](https://github.com/openape-ai/openape/pull/127) [`d8e1516`](https://github.com/openape-ai/openape/commit/d8e15161d7edda67139633ec18c959a2cc8a57bd) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase 4: Safe-Commands seeding + UX.

  - Agent enrollment now auto-seeds 14 default safe-command standing grants for the new agent (ls, cat, head, tail, wc, file, stat, which, echo, date, whoami, pwd, find, grep). Low-risk read-only invocations of those CLIs auto-approve without a prompt.
  - New UI section on `/agents/:email` to toggle defaults and add custom safe commands.
  - New `/agents` page modal to bulk-apply safe commands across all of a user's agents (idempotent — already-present entries are skipped).
  - New endpoint `POST /api/standing-grants/bulk-seed` for the bulk-apply flow.
  - Recent-activity table on `/agents/:email` now shows a distinct "Safe cmd" badge for auto-approvals traced to a safe-command standing grant.

  Existing agents are not retroactively modified; use the bulk-apply modal to opt in.

## 0.2.0

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
