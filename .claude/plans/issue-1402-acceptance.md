# Pods UX acceptance contract

## Scope and reference

The approved Variant A prototype (`pods-workflows.html`) is the design reference. Test the real Vue components with their production stylesheet and synthetic bridge fixtures. The prototype's simulated behavior cannot prove the implementation works. The new design has not yet been migrated into the app; this document defines its implementation acceptance criteria.

Infrastructure inspected at canonical main `d1da9ac7aff30f1425ffbbae08b91866bf85b99d` on 2026-09-28. No new test execution or production code changes were performed for this contract.

## Existing infrastructure to extend

- `apps/openape-pods/test/**/*-ui.test.ts`: Vue Test Utils and happy-dom component behavior in the existing unit gate.
- `apps/openape-pods/test/layout/**/*.test.ts`: Vitest Browser Mode with the Playwright Chromium provider and installed Chrome.
- `apps/openape-pods/test/layout/setup.ts`: imports the real `src/renderer/style.css`; component styles also load through Vite.
- `apps/openape-pods/test/layout/workflows.test.ts`: already captures screenshots using `page.screenshot`, checks overflow and node geometry, and exercises keyboard dependency editing.
- `apps/openape-pods/scripts/report.mjs`: currently requires `electron-tests.json` and a fixed mix of native and browser screenshots. Extend it with an explicit component/browser report input when implementing the redesign; do not require Electron evidence for a browser-only acceptance run and do not reuse stale screenshots.

## Behavioral and visual acceptance

| Surface | Component assertions | Browser evidence |
| --- | --- | --- |
| Navigation and inventory | Workflows, Pods and App Settings; standalone and workflow membership; create draft; archived list | Populated and empty inventory; readable long names; narrow navigation |
| Pod editor | Edit/save/discard; dirty-route confirmation; remote revision conflict preserves draft | Script highlighting and line alignment; long code scroll; conflict and error states |
| Permissions | Directory/application/HTTP add, edit and remove; immutable owned paths; selected methods emitted correctly | Approved list and plus/minus pattern; long paths and methods wrap without clipping |
| Runs | Correct save/validate/start order; failed validation prevents start; cancellation and approval; retry requires reconciliation where needed | Running, waiting, failed and completed states; readable history |
| Workflows | Membership, cycle refusal, dependency and handoff commands; schedule validation; archived member prevents start | Parallel and sequential graph, editor, history; long names and narrow width |
| Accounts | Exactly DDISA/OpenApe, Codex, TypeSafe (Jev); connected, expired, error and disconnected states | App Settings with account management and failure feedback |
| MCP access | App-wide only; AUS/read/write; active mode starts service; 1 h/1 day/permanent; expiry returns to off; active-mode change does not extend deadline | All three levels and bounded/permanent duration; runtime state inside the same card |
| Results and sources | Findings/questions/gaps and correct retained source version | Empty and populated results, source panel |
| Lifecycle | Group change, archive read-only behavior, no archived run; explicit deletion confirmation | Archived inventory and destructive confirmation |
| Desktop and data | Offline start refused, valid concurrency/storage values, backup/restore state and error feedback | Offline banner, backup/restore and update views |

MCP authorization also requires control/IPC/server tests: disabled access denies reads and writes, read-only denies mutation and execution, expiry is enforced at the service boundary, and an agent cannot grant or extend its own access. Browser buttons alone do not prove these restrictions. Existing resource grants remain independent.

## Deterministic screenshot procedure

1. Use fixed fixture data, frozen display dates, stable account states and the production fonts/CSS. Stub only external boundaries. Never use real credentials or personal Pod data.
2. Assert that the intended component and key content are actually present before measuring layout or taking a screenshot.
3. Exercise representative desktop and narrow breakpoints in light/dark appearance and German labels. Reuse the existing supported-width contract rather than inventing a mobile product requirement.
4. Assert no viewport overflow, readable node widths, visible critical actions and keyboard operability. Keep targeted counter-proofs for new geometry assertions.
5. Capture the actual rendered components after the state settles. Review each screenshot against the approved mock. Screenshot capture alone is not a visual assertion.
6. If automated pixel comparisons are later introduced, approve baselines from the real implementation first. Do not compare a standalone HTML mock pixel-for-pixel with differently structured Vue output or update baselines simply to make failures green.

## Report contract

Produce a clean evidence directory for each run with component/browser JSON results, only the screenshots captured during that run, and a Test Runs manifest. Record commit SHA, dirty state if any, commands, browser/viewport/theme, test outcomes and a separate visual-review outcome. Missing expected screenshots must fail report assembly; failed tests must remain failed. Never label an unimplemented design state as passed.

Publish the report through OpenApe Reports under Test Runs and verify the returned report and category. Mark actual native/runtime integration as outside browser acceptance unless separately executed. Reports should show a reference/implementation comparison for key redesigned screens and explain intentional differences.

## Existing commands

From an appropriate isolated checkout, activate the repository Node version and run `pnpm run doctor` first. Existing commands:

```sh
pnpm --filter @openape/pods test
pnpm --filter @openape/pods test:browser
pnpm --filter @openape/pods test:fast
```

Use focused test-file selection while implementing individual screens. Keep component tests in automatic CI. Browser/layout acceptance remains an explicit manual command under the current owner decision; this request does not implicitly re-enable automatic layout or native E2E jobs.

## Implementation sequence

For each migrated screen: extend its existing behavioral fixture and component tests, implement the Vue view, extend the relevant browser suite, inspect screenshots against Variant A, and attach the verified report. Complete app-wide MCP boundary tests with its implementation. The current report-generator dependency is a concrete follow-up within that work.
