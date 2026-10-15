# UI development without Electron

From an installed worktree, activate the repository toolchain and start Vite:

```sh
. ./scripts/activate-node.sh
pnpm --filter @openape/pods dev:ui
```

Open http://127.0.0.1:5478. Only Vite runs: no Electron process, worker,
SQLite database, account login or backend. It serves the actual Vue components
and stylesheet with hot reload. The server binds to loopback and fails if the
port is occupied. In a second worktree choose another explicit port:

```sh
pnpm --filter @openape/pods dev:ui --port 5479
```

Each worktree keeps its own Vite cache, dependencies, build output and test
artifacts. Stop only the server process started in that worktree; never kill
other Vite or Electron processes by name.

## Scenarios and supported actions

The toolbar selects a scenario and resets it. URLs preserve the scenario:

- `/?scenario=everyday`: six related Pods, two company tags, four questions,
  public variables, scripts, schedules and run history.
- `/?scenario=attention`: a failed run, a waiting IdP action and a choice that
  first fails, then succeeds on retry.
- `/?scenario=empty`: an empty workspace and decision inbox.
- `/?scenario=loading-error`: delayed reads and a connection failure. Use the
  demo reconnect button to restore reads.

Add `&language=en` for English product labels. Synthetic content remains German.
The toolbar identifies simulation throughout the session.

Use the existing map/list switch and tags, open Pod details, pause/resume,
start a simulated run, change the description, name, tags, public variables or
schedule, inspect code and history, and answer single/group questions. Changes
update the same in-memory state across views. The simulated run completes after
900 ms; no script executes. Stale edits fail rather than overwrite newer data.

Native tools, authentication, secrets, script editing, package installation and
other unimplemented operations report an explicit demo limitation. Opening an
IdP action shows a local explanation; it grants nothing. No demo operation calls
an external service. All identities and data are invented.

State lasts until reset, scenario change or reload. Reset discards edits,
cleans timers and draft buffers and returns to the initial list and tags. Hot
reload of fixture/controller modules can reset state too.

## Shared frontend and real adapters

`WorkspaceShell.vue` owns shared refresh and action-error behavior and renders
`AutomationsShell.vue` and `DecisionsInbox.vue`. `workspace-access.ts` supplies
local and backend capabilities. `LocalShell.vue` is the desktop host wrapper;
`BrowserWorkspace.vue` supplies the backend adapter and its inbox link.

`PodAccess` and `remotePodAccess` remain the shared Pod editor boundary.
`hostBridgeKey` injects host-only services into native subcomponents. Only
`adapters/electron.ts` reads the native global. Normal Electron startup supplies
its real preload bridge; the explicit UI mode supplies a separate demo instance.
No demo installs or replaces `window.pods`.

The demo uses the existing command and view contracts. It does not redefine
backend business rules. Genuine availability stays with the host: browser
questions continue to use the authenticated Pods inbox, and native controls
retain their existing availability restrictions.

To transfer a UI iteration:

1. Edit the shared component, style or controller while Vite is running.
2. Run focused browser checks, plus affected contract tests when behavior changes.
3. Build/run the normal Electron or relay consumer. Its existing entry point
   already supplies the real adapter; there is no component copy or API rewiring.

```sh
pnpm --filter @openape/pods build
pnpm --filter @openape/pods dev
pnpm --filter @openape-pods-relay/app build
```

The normal renderer build excludes demo data and the toolbar even with
`vite build --mode ui`; only Vite's development command enables simulation.
Installation and deployment use the established workflows. New backend fields
or commands still require their actual backend implementation and contract tests.

## Tests

Use the established suites; do not add an Electron E2E test for UI behavior:

```sh
pnpm --filter @openape/pods test --maxWorkers=4 test/workspace/demo.test.ts test/workspace/adapter-contracts.test.ts
pnpm --filter @openape/pods exec vitest run --config vitest.browser.config.ts test/layout/demo.test.ts
```

`demo.test.ts` validates production payloads, consistent state, conflicts,
failures and cleanup. `adapter-contracts.test.ts` checks real IPC/HTTP clients
and remote operation settlement with narrow transport doubles. Existing worker,
storage and relay suites verify backend effects independently of the demo.
`test/layout/demo.test.ts` exercises the actual UI with real CSS, captures wide
and narrow screenshots, and verifies edits and reset without a native global.
The existing desktop/browser parity tests retain the real host configurations.

Keep UI expectations shared; avoid duplicating all scenarios for every adapter.
A CSS-only change needs focused browser checks. A command/contract change also
needs its affected adapter/backend tests. Screenshots prove appearance;
transport and backend results are recorded separately.

`test:layout` now runs only the browser suite. Explicit `test:e2e` owns native
build/package acceptance. Use the [test selection table](testing.md#choose-the-check-for-the-change)
for the focused iteration loop and final gates; a UI change does not require
repeating the native suite.
