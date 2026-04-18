# @openape/idp-test-suite

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
