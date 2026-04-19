# Changelog

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
