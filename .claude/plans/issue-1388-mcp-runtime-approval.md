# Local MCP runtime approval

## Purpose and approved scope

The owner approved this design in the conversation on September 25, 2026 and requested implementation in an isolated worktree. Add a default-off desktop checkbox that authorizes automatic approval of the reusable execution grant for Pods created by local MCP. Preserve validation, sandboxing, resource permissions, the original owner/decision IdP and explicit denial/revocation. Disabling the option stops future automatic approvals without revoking already approved grants. No owner-app installation is part of this change.

Issue: https://repos.openape.ai/patrick/monorepo/issues/1388
Worktree: `pods-mcp-runtime-approval`; branch: `feature/issue-1388-mcp-runtime-approval`.
Base: `98cf9078600f5ec94585294772db78cdd7c8cf81`.

## Implementation

1. Persist the desktop setting and trusted local-MCP creation provenance in the private profile, outside Pod workspaces and central snapshots. Cover direct MCP create and local-runtime central create submissions. Do not infer provenance from names, edited scripts, or client-supplied flags.
2. Expose get/set only through the owner renderer IPC with strict parsing and sender validation. Display the checkbox in desktop settings with English/German text and explicit existing-grant semantics.
3. Before showing a pending runtime grant, let the main process approve its exact Pod-scoped permission using the bound owner account. Verify original identity, target, broker binding and narrow permission; re-read status and retain normal signed-token verification/consumption. Never replace a denied/revoked grant.
4. Extend existing component, main-process, grant and connection suites. Retain negative tests because this is an authorization contract. Verify settings visually in an isolated browser fixture. Update the handbook, full lint/typecheck, app build and relevant tests; publish a native PR with exact-head CI.

## Validation and rollback

Use the pinned toolchain via `scripts/activate-node.sh`. Commands: `pnpm lint`, `pnpm typecheck`, `pnpm --filter @openape/pods build`, and the established Pods unit/component and focused browser suites. Build consumed dependencies before typecheck. All test data stays isolated; no live owner grants are approved by acceptance tests. Rollback is the previous application build; missing preference/provenance defaults to manual approval.

## Progress

- September 25: Scope approved; issue and isolated worktree created; frozen dependencies installed.
- Implemented desktop IPC/checkbox, persisted local provenance, central-operation binding and exact owner-approved runtime grants.
- Verification: full `pnpm lint` and `pnpm typecheck`; Pods build; 515 unit/component tests; two real Chrome settings tests (English/light and German/narrow/dark). Screenshots inspected, self-contained report at `apps/openape-pods/.artifacts/runtime-approval-report.html`.
- Permanent tests cover consequential authorization boundaries and owner-visible setting behavior. Existing suites/runners are unchanged.
- Native [PR 140](https://repos.openape.ai/patrick/monorepo/pulls/140) created and explicitly linked to issue 1388; implementation commit `a610cc9ce1fef75375347e6af38da346b01fceae`. Commit/push affected unit gates passed, including the relay consumer.
- Exact-head external checks and owner review remain. The installed owner app stays on its existing build.
