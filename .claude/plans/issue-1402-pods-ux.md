# Plan: Pods Variant A and browser evidence

## Purpose and approved scope

Deliver the owner-approved Variant A as working desktop UI: first-class Workflows, current/archived Pods, complete Pod editing and centralized settings. Preserve existing execution, recovery, permission, identity and storage semantics. Add app-wide timed OFF/read/write MCP access with server-side denial. Test real Vue components and production CSS; publish actual outcomes and inspected screenshots in OpenApe Reports.

The owner approved the mock, then the acceptance contract and explicitly confirmed “complete interface including tests” on 2026-09-28. This plan operationalizes that approved scope. Installation, deployment, account connections and changes to actual Pod data are excluded. Browser tests remain manual.

Published plan: https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3M9ZTF4N6PQR30V8CM6MQCX.

## Repository orientation

Worktree: openape-monorepo.worktrees/pods-ux-verification. Branch: feature/issue-1402-pods-ux. Base: d1da9ac7aff30f1425ffbbae08b91866bf85b99d. Issue: https://repos.openape.ai/patrick/monorepo/issues/1402.

The active desktop entry is src/renderer/central/DesktopWorkspace.vue and CentralWorkspace.vue; App.vue remains the local entry. Reuse working PodScript, PodSettings, PodResources, PodRuns, PodKnowledge, Onboarding and DataManagement components. Vue 3, TypeScript, own CSS, Vitest + Vue Test Utils, browser-playwright with installed Chrome. MCP enters through src/main/codex/server.ts; local renderer IPC is separately sender-validated in main/app.ts.

Setup: activate scripts/activate-node.sh, pinned pnpm 10.29.3, pnpm install --frozen-lockfile, pnpm run doctor. Build consumed workspaces serially before checks.

## Milestones

1. Central MCP policy: strict commands/state, off-by-default persisted durations, read-only allowlist, expiry at each request, socket lifetime reconciliation, trusted IPC settings and component UI. Preserve Codex registration separately. Verify denial, expiry, restart, malformed input and trusted sender behavior.
2. Variant A desktop/local navigation and inventory: Workflows / Pods / Settings; current/archive tabs; standalone versus workflow membership; + New Pod; shared design styling and complete local editor access from the central desktop without routing another runtime's Pods into local IPC. Preserve remote workspace operations and revision handling. Verify inventory, navigation, active-runtime routing, archived state and workflow selection.
3. Pod/editor and settings completion: retain script highlighting/dependencies/conflicts, permission lists, values, runs/recovery, results/source and identity; central settings account rows DDISA/OpenApe, Codex and TypeSafe (Jev), MCP status entirely inside access card, desktop/storage/update controls. Workflows expose membership, dependencies, schedules and run history. Verify existing behavior plus redesigned paths.
4. Evidence: extend existing component/browser suites. Isolated run directory, component/browser JSON results, expected screenshot list, source SHA and manifest. Report assembly refuses missing/stale evidence and preserves failures. Inspect light/dark and desktop/narrow captures against the approved design. Publish and verify Test Runs report.
5. Delivery: full lint and typecheck, app build, relevant component/browser suites and required native boundary harnesses; native PR with issue relation, exact-source CI and handoff. No installed application replacement.

## Acceptance

Behavior: standalone creation, archive inspection, editing and failed-validation protection, workflow cycle refusal, preserved dirty drafts, resource add/remove, account errors, no disabled/read-only MCP mutation, expiry without agent extension, offline start protection. Layout: real CSS, readable names/paths, no viewport overflow at supported breakpoints, accessible navigation and controls, light/dark German captures. Screenshots are reviewed evidence, not a substitute for assertions.

## Rollback

Revert this feature branch's changes through a PR. No owner data is migrated. MCP grants default off when state is absent; existing registrations remain unchanged unless the owner explicitly connects/disconnects through Settings.

## Progress

- 2026-09-28: Read current main and testing/operations guidance, installed frozen dependencies, created isolated checkout and issue. Reviewed existing browser screenshots and report generator. No production changes.

- 2026-09-28: Implemented shared navigation, inventory/archive filters, local editor routing, compact accounts and timed MCP policy. 638 component/unit assertions and the initial 28 browser assertions passed. Full monorepo lint/typecheck passed; final evidence suite and native PR remain. All 31 browser assertions and 43 focused boundary/report assertions subsequently passed; screenshots were inspected and account/navigation layout refined.

## Discoveries

- main.ts chooses DesktopWorkspace when central is enabled. Changing only App.vue would miss the installed app's active UI.
- Existing report.mjs requires Electron results even when screenshots come from Vitest Browser. A separate explicit report mode is needed.

## Decisions

- Extend existing suites and fixtures. Retain native tests only for actual OS boundaries.
- Existing real components own behavior; do not promote the standalone mock's simulated operations into production.
- The user's complete-scope approval authorizes implementation under the previously reviewed acceptance matrix.

## Outcomes

Implementation is complete. Full monorepo lint/typecheck, app build, 641 unit/component tests and 31 browser tests passed on the committed implementation. Final screenshot review, report publication and native PR verification are in progress. The installed app and owner profile remain untouched.
