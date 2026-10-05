# Plan: Owner-scoped standing Pod runtime approval

## Purpose / Big Picture
The owner approved the proposal and implementation in this chat on October 5, 2026. Existing and future Pods on this runtime should start scripts without repeated owner prompts after one explicit opt-in. Runtime permission never authorizes mail delivery, new programs, network access or secrets.

## Repository orientation
Canonical repository: https://repos.openape.ai/patrick/monorepo. Issue: https://repos.openape.ai/patrick/monorepo/issues/1422. Base: d5cbc516d7a3399cdef5369021d299eba56d0ade. Checkout: /Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo.worktrees/pods-standing-runtime. Branch: feature/issue-1422-standing-runtime.

The Electron main process owns RuntimeApprovalPolicy, ConnectionManager and AgentAuthority. The renderer uses the trusted runtimeApproval IPC channel; MCP and central commands cannot alter this policy. The existing JSON preference preserves local-MCP provenance. AgentAuthority checks each exact runtime grant and separately checks operation grants. RuntimeApprovalSettings.vue uses Vue Options API. Tests use existing Vitest unit/component and browser suites.

## Milestone 1: Standing runtime policy
Add a separate opt-in bound to the current owner identity and local runtime. Preserve the old MCP-only preference without widening migrated consent. Cover all existing/future Pods of the bound owner. Check the binding again immediately before approval and serialize preference changes with approvals to avoid a late approval after disabling. Keep exact per-Pod always grants and denied/revoked behavior. Existing grants remain independently revocable at the decision IdP; link to that existing management surface instead of creating a second grant lifecycle.

Acceptance: existing and future Pod identities can obtain exact runtime-only grants; other owner/runtime identities cannot; disabling prevents new approval; operation and denied/revoked requests remain blocked. Repeated runs reuse approved grants through the existing authority path. Migration retains narrower consent.

## Milestone 2: Settings and verification
Expose standing approval separately from MCP-only approval, with the current owner and explicit scope for manual/scheduled/repeated runs. Explain that turning off automatic approval does not revoke existing grants, and provide access to existing grant management. Update handbook and translations. Retain regression tests because broadening this authorization incorrectly would grant unintended authority.

Run `. ./scripts/activate-node.sh`, use pinned pnpm10.29.3, and `pnpm run doctor`. Install frozen dependencies. Run lint, typecheck, app build, existing targeted unit/component tests and browser layout tests; inspect screenshots. Run repository-required checks before commit and required CI for the pushed head. Publish actual results under private Reports/Test Runs and verify the link. Create and attach a native PR, explicitly link the issue, and merge only with required exact-head checks. Deliver signed local build if release gates pass.

## Rollback
Revert the feature PR and reinstall the prior signed desktop if necessary. Disabling the preference stops new approvals. Existing IdP grants require separate explicit revocation; do not silently revoke unrelated grants, change scripts, enable schedules or broaden action permissions.

## Progress
- 2026-10-05: Proposal approved by owner; current architecture and existing suites inspected; issue1422 and isolated worktree created.

- 2026-10-05: Implemented owner/runtime binding, explicit opt-in, retained legacy scope, serialized decisions, trusted settings IPC and IdP management navigation. Focused suite: 72 passed. Full lint and typecheck pass. Added a scope receipt to reject stale settings after account/runtime changes; final verification passed: pnpm lint (54 tasks), pnpm typecheck (77 tasks), Pods build, pnpm check:ci --suite unit (including 1305 Pods tests), and two browser settings tests. Both final screenshots were personally inspected.

## Decisions
- Preserve the narrower legacy opt-in; no silent migration to all Pods.
- Use the existing IdP grant-management surface for revocation rather than duplicating its lifecycle.
- Continue enforcing exact owner/Pod/broker/action bindings.

## Outcomes
Pending implementation and verification.
