# Testing OpenApe Pods

Every assertion lives on the lowest level that can answer its question. A packaged Electron launch costs seconds; a component test costs milliseconds. [Issue 1374](https://repos.openape.ai/patrick/monorepo/issues/1374) moves the existing suite down this ladder; its plan is `.claude/plans/issue-1374-test-pyramid-pods.md` in the repository root.

| Level | Where | Answers | Runs in |
|---|---|---|---|
| Unit / functional | `test/**` (Node, happy-dom) | Pure functions, contracts, worker modules against real SQLite and files | `pnpm --filter @openape/pods test` (unit gate) |
| Component | `test/**/*-ui.test.ts`, `test/workspace.test.ts` (`@vue/test-utils` + happy-dom) | Vue states, branches, visible text, emitted bridge commands | unit gate |
| Main process and worker entry | `test/main/**` (Node; `vi.mock('electron')` via `test/main/app-harness.ts`, an in-memory `parentPort` for `src/worker/entry.ts`) | The unchanged `src/main/app.ts` and worker entry: IPC sender checks, native dialog gating, menus, power events, scheduler intake while suspended | unit gate |
| Layout | `test/layout/**` (Vitest browser mode, installed Chrome) | Widths, overflow, breakpoints, dark mode — with `src/renderer/style.css` and every SFC `<style>` loaded | `test:browser` / browser-only `test:layout` |
| Native / packaged | `e2e/**` (Playwright Electron, native helper) | Only what needs the packaged app or a real OS boundary | explicit `test:e2e` (build + package + 6-worker native suite) |
| Fast local loop | unit, component, main-process and layout levels above | Unit/component and browser suites without building or launching Electron | `pnpm --filter @openape/pods test:fast` |
| Handbook capture | `e2e/handbook-capture.test.ts` | Screenshots for the handbook and the evidence report — a generator, not a check | `pnpm handbook:capture`, outside the gate |

## Choose the check for the change

| Change | During iteration | Additional acceptance |
| --- | --- | --- |
| Text, CSS, navigation, filtering, visible loading/error states | Focused cases in `test/layout` with real CSS; capture screenshots when appearance changes | Existing lint/typecheck and affected unit gate |
| Editing, pause/resume, choices, async refresh or revisions | Focused browser interactions plus affected controller/adapter tests | Real worker/relay tests for changed effects or contracts |
| IPC, database persistence, actual execution, restart, keychain, sandbox or package | Existing boundary tests at the lowest sufficient level | Relevant explicit native E2E cases; full suite for release acceptance |

Use the actual shared components and deterministic demo data for the fast UI
loop. Keep one set of UI expectations and a small representative adapter parity
set. A simulated successful run proves presentation; actual execution and durable
storage need their own boundary evidence. New backend fields/commands require
real backend implementation and tests.

```sh
# One UI scenario file; append -t to select a behavior within it.
pnpm --filter @openape/pods exec vitest run --config vitest.browser.config.ts test/layout/demo.test.ts
# Entire browser suite, without Electron, build or packaging.
pnpm --filter @openape/pods test:layout
# Controller/adapter contracts when commands or state handling change.
pnpm --filter @openape/pods test --maxWorkers=4 test/workspace/demo.test.ts test/workspace/adapter-contracts.test.ts
# Complete local unit/component + browser acceptance, without Electron.
pnpm --filter @openape/pods test:fast
# Explicit native acceptance, including its build/package prerequisites.
pnpm --filter @openape/pods test:e2e
```

During editing, rerun the focused cases after each relevant change. Run the
affected unit gate (including lint/typecheck) through the pre-push hook once;
commits retain only branch and lockfile guards. For handoff without a push, run
that gate explicitly. Reuse successful focused results only while their source
and dependencies are unchanged. Run the broader relevant acceptance once at handoff, rather than
repeating build/package/native suites after each visual edit. Existing coverage
must remain: move UI assertions only after their replacement proves the same
behavior, retain real native effects, and record the mapping in the PR.

The October 15 UI acceptance measured 63 browser cases in 21.16 seconds and
1,794 Pods unit/component cases in 38.58 seconds, as separate runs on this Mac.
These are observations, not deadlines or a measured E2E speedup percentage.
The [Test Run](https://report.openape.ai/d/01M4YD9F33NX8VY85MN8ZSB3KK?v=2)
contains their actual output. See [UI development](ui-development.md) for the
isolated Vite server and adapter handoff.

## Rules

- Automatic CI and merge checks run unit/component tests only (owner decision,
  September 24, 2026, issue 1379). Browser layout and native/packaged E2E remain
  manual acceptance: `pnpm --filter @openape/pods test:layout` runs browser
  tests only; `pnpm --filter @openape/pods test:e2e` builds, packages and runs
  native acceptance. Only the latter requires an unlocked Mac. Both are reachable
  through their explicitly selected shared suites; neither runs implicitly on push.
- No check waits for a person (issue 1450). Pods keeps no secret in the macOS
  keychain (issue 1519): credentials are private 0600 files and Chromium always
  runs with its mock keychain. Only a profile with retired keychain files starts
  once without it so a Developer ID signed build can migrate them; fixture
  launches with `NODE_ENV=test` never do. `e2e/fixtures/keychain.ts` stops the app as soon as macOS shows a keychain or
  authorization dialog (`credentials`, `programs`, `test:distribution`).

- Vue behaviour goes to a component test. Assert visible text and the exact bridge command, not CSS classes.
- Anything with a size, a position, a breakpoint or a colour scheme goes to `test/layout`. happy-dom computes no layout.
- `test/layout/setup.ts` imports only the production stylesheet. Never add a rule there that a component should carry itself; it would hide the loss of the real rule.
- Dark mode in `test/layout` sets `color-scheme: dark` on the root element. The stylesheet uses `light-dark()` tokens, so this is the same switch the system preference makes.
- Every moved assertion needs a counter-proof: break the rule or behaviour, watch the test turn red, restore it. A layout test that stays green when its rule is removed measures something else.
- Screenshots that `scripts/report.mjs` embeds keep their file names. Browser-mode images are marked `test/layout` in their caption.

## Packaged E2E that remains, and why

These are the questions no lower level can answer. `handbook.test.ts` also stays: it opens the generated offline handbook in Chrome.

| File | Why it needs the packaged app or a real process |
|---|---|
| `foundation.test.ts` | Packaged start with Electron 40.9.3 / Node 24.14.1 and rendered Vue; bundle icon; renderer/IPC boundary and worker environment scrubbing; single instance and quit; worker crash detection; packaged manual run in the sandbox; packaged reference snapshot |
| `crash-recovery*.test.ts`, `fixtures/crash.ts` | Real SIGKILL/quit of worker, app and script, relaunch and domain inspection without duplicate work; the storage limit stopping an actually running script. Split into files so the cases run on separate workers |
| `recovery.test.ts`, `domains.test.ts` | Supervisor lease, PID identity and PID reuse of real processes |
| `resources.test.ts`, `script-runner.test.ts`, `terminal.test.ts` | Sandbox denial (files, fork, network, shell), real TTY, time limits |
| `agent.test.ts`, `master.test.ts`, `onboarding.test.ts`, `mail-knowledge.test.ts` | Pinned Codex binary and app-server confined by the sandbox; native draft validation as the provider actually receives it |
| `external-shell.test.ts`, `external-session.test.ts`, `installed-applications.test.ts` | `ape-shell` from the package reaches real child processes; grant denial blocks the side effect |
| `o365.test.ts`, `broker.test.ts` | TLS against a real socket with the packaged helper; credential isolation between sandboxes |
| `credentials.test.ts` | Private 0600 credential files: read again after a restart, erased on rotation and revocation, other Pods' files kept |
| `programs.test.ts` (packaged case) | safeStorage-backed program state, the folder dialog path and a saved script reaching the application through worker, main broker and `ape-shell`; a read-only folder refuses writes |
| `dependencies.test.ts` | A bare import resolves from the prepared, read-only library inside the sandbox (Node, no Electron) |
| `codex-mcp.test.ts`, `codex-registration.test.ts`, `codex-acceptance.test.ts` | Issue 1375: the launcher starts the packaged shim without global Node; the bundled Codex CLI reads the appended entry and the owner's `config.toml` is restored byte for byte; a real `codex app-server` is refused with `login_required` until the owner session exists, then administers the running app directly with no review queue. The refusals themselves are measured one level lower in `test/codex/control.test.ts` and `test/main/codex-*.test.ts` |

## Moved in issue 1374

Historical mapping; replacements for removed features (chat, master UI) were deleted with them.

| Former E2E | Replacement |
|---|---|
| `pod-workspace.test.ts` | `test/layout/app-shell.test.ts` (7 views at one size per breakpoint band, dark at the tightest size, German at compact and narrow sizes, source viewer, contextual chat), `test/workspace/shell-ui.test.ts` (arrow-key tabs, archived pod cannot run, Discuss knowledge, connections hidden), existing `test/workspace/ui.test.ts`, `test/resources/ui.test.ts`, `test/settings.test.ts`, `test/scheduling/ui.test.ts`, `test/workspace/description-ui.test.ts`, `test/workspace.test.ts` |
| `groups.test.ts` | `test/workspace/groups.test.ts` (persistence), `test/workspace/groups-ui.test.ts`, `test/workspace/shell-ui.test.ts` (drag and drop, Settings group), `test/layout/app-shell.test.ts` (long group name wraps, with counter-check) |
| `language.test.ts` | `test/i18n/language.test.ts`, `test/i18n/ui.test.ts`, `test/layout/app-shell.test.ts` (German views, language switcher in a narrow window); native menu and dialog labels in `foundation.test.ts` |
| `foundation.test.ts` (unpackaged arms, scheduling, storage, layout) | Packaged arms kept; `test/workspace/shell-ui.test.ts` (concurrency limit), `test/workspace/script-authority.test.ts` (unknown create keys rejected), `test/storage/database.test.ts` (reopen), `test/layout/app-shell.test.ts` (empty profile light/dark, 880 × 640) |
| `master-ui.test.ts` | `e2e/master-chat.test.ts` (model reaches the provider, Node), existing `test/master/ui.test.ts` (palette, model picker, decline, collapsed activity), `test/master/chats-ui.test.ts`, `test/workspace/chat-changes.test.ts`, `test/layout/master-chat.test.ts` (alignment, composer, palette at 560, scroll-follow) |
| `chat-setup.test.ts` | `test/main/app.test.ts` (HTTP, folder and program dialogs), `test/master/chat-surfaces-ui.test.ts` (BotFather guidance, Continue setup while disconnected), existing `test/master/setup-ui.test.ts`, `test/master/setup.test.ts` (secret never in chat), `test/layout/master-chat.test.ts` (560 dark German) |
| `prompt-setup.test.ts` | `e2e/master-chat.test.ts` (repair from native validation feedback, staged changes, reviewed run — same `PromptModel` scenario, Node), `test/master/chat-surfaces-ui.test.ts` (description label), existing `test/master/ui.test.ts` (secret proposals route to Values) |
| `chats.test.ts` | `e2e/master-chat.test.ts` (fresh provider context after a context change, Node), `test/master/chat-surfaces-ui.test.ts` (rename), existing `test/workspace/chat-registry.test.ts`, `test/workspace/chat-changes.test.ts` (context, review, run receipt), `test/layout/master-chat.test.ts` (1060/760/560) |
| `readable-runs.test.ts` | `test/workspace/run-history-ui.test.ts` (real `RunStore` → `RunDispatcher.view` → `PodRuns`, en/de; both approval-retirement rules proven separately; allow-listed environment with hostile keys — the old check never injected a secret), `test/layout/pod-tabs.test.ts` (680/600 px) |
| `values-tab.test.ts` | `test/workspace/values-tab.test.ts` (empty variables and a declared secret assign nothing, real SQLite; German tab; no secret form in Settings), existing `test/workspace/values-ui.test.ts`, `test/credentials/ui.test.ts`, `test/layout/pod-tabs.test.ts` (560 dark, row width, long alias with counter-check) |
| `script-editor.test.ts` | `test/workspace/script-run-ui.test.ts` (save → validate → activate → start with the validated hash; a failed check starts nothing; draft message and references; sidebar keyboard resize, remembered width, collapse), existing `test/workspace/script-ui.test.ts`, `test/workspace/scripts.test.ts`, `test/layout/pod-tabs.test.ts` (bounded editor, 560 dark) |
| `terminal-feedback.test.ts` | `test/main/app.test.ts` (Terminal.app opens only with a prepared launcher, never after a failed preparation — the old test never checked this; a failed open releases the reservation), existing `test/programs/ui.test.ts`, `test/layout/pod-tabs.test.ts` (feedback directly below the button) |
| `dependencies.test.ts` (packaged editor case) | Node import case above, `test/main/app.test.ts` (preparation dialog), existing `test/workspace/script-ui.test.ts` (search/add/remove), `test/layout/pod-tabs.test.ts` (`.http-heading` spacing) |
| `credentials.test.ts`, `programs.test.ts` (UI and layout parts) | `test/layout/pod-tabs.test.ts`, existing `test/credentials/ui.test.ts`, `test/programs/ui.test.ts`, `test/main/app.test.ts` (program picker) |
| `onboarding.test.ts` (packaged cases) | `test/onboarding/setup-state.test.ts` (incomplete until the explicit finish, consent kept across a restart, continue only after the worker accepted, avatar in the collapsed sidebar), existing `test/onboarding/ui.test.ts`, `test/onboarding/control.test.ts`, `test/onboarding/reconcile.test.ts`, `test/onboarding/auth.test.ts`, `test/layout/onboarding.test.ts` (560 dark en/de, collapsed avatar) |
| `data.test.ts` | `test/main/data-dialogs.test.ts` (delete/backup/restore wait for the owner's native confirmation; restore with the real `restoreBackup` while the worker refuses a newer database; startup opens the selected profile — the old test had stubbed the relaunch anyway), existing `test/data/backup.test.ts`, `test/data/update.test.ts`, `test/data/ui.test.ts`, `test/layout/onboarding.test.ts` (Data & backups at 560) |
| `handbook.test.ts` (capture case) | Moved unchanged to `e2e/handbook-capture.test.ts`, run with `pnpm handbook:capture` |
| `mail-knowledge.test.ts` (unpackaged parser arm, gap case) | `test/mail/extraction.test.ts` (plain/HTML/PDF/DOCX text, scripts and tracking images dropped, unsupported/scanned/malformed/oversized as gaps); the packaged parser run and the recipe stay |
| `foundation.test.ts` (reporting menu, German menus and delete dialog) | `test/main/app.test.ts` (menu only after opt-in, fixed report URL, menus rebuilt on language switch, German delete dialog) |
| Unpackaged arms of `agent`, `broker`, `master`, `o365` and `resources` | Packaged arms kept: the shipped bundle runs the same runtime code as the development build, plus its own Electron-as-Node and helper paths. The development helper and `dist` runtime stay exercised by the other Node-level cases in `agent`, `broker`, `master` and `resources` |
| `crash-recovery.test.ts` (suspend case) | `test/main/worker-entry.test.ts` (unchanged worker entry: no intake while suspended, missed slots caught up once), `test/main/app.test.ts` (powerMonitor forwarded), `test/main/worker-lifecycle.test.ts` (forwarded only to a ready worker), existing `test/scheduling/scheduler.test.ts` (coalescing) |

## Deliberately kept in `e2e/`

Some checks inside the native files are pure logic but cost almost nothing there (the script and tool hash checks in `resources`, `script-runner` and `terminal`, < 0.1 s each), or need the script-entry frame protocol (the remaining `dispatcher` cases). Moving them would either save nothing or replace a real sandboxed process by a mock of its protocol, so they stay.

## Variant A component and browser evidence

`pnpm --filter @openape/pods report --browser` runs the existing unit/component
suite and Vitest Browser suite with the production stylesheet. It creates a
new `.artifacts/browser-reports/<timestamp>-<id>/` directory containing JSON
outcomes, complete logs, a source/command receipt, screenshots, `testrun.json`
and a self-contained `report.html`. It needs installed Chrome (or `CHROME_PATH`)
but does not build, package or launch Electron and never reads an owner's Pod
profile. Browser acceptance remains manual and is not added to automatic CI.

Inspect the captured images against Variant A. Capture success alone does not
approve appearance: the initial manifest marks visual review as skipped. After
personal inspection, assemble the same immutable evidence with:

```sh
pnpm --filter @openape/pods report --browser --assemble /absolute/run/directory --reviewed
ape-report-render test-run /absolute/run/directory/testrun.json /absolute/run/directory/verification.html
ape-reports publish /absolute/run/directory/verification.html --category 'Test Runs' --key YOUR_RUN_KEY --json
```

The assembler rejects missing, older or altered screenshots and retains failed
assertions/runner errors. It uses the recorded source revision and command
outcomes, not the current HEAD. Use a clean committed source for delivery; dirty
runs are explicitly labelled. Open the returned report and verify its images
and **Test Runs** category before sharing it. Live sign-in, native execution,
installed distribution and release signing are separate acceptance boundaries.

Retained feature tests cover the MCP owner session, its expiry and IPC denial, socket revocation,
standalone/archive navigation, editor routing by runtime,
script validation before execution, and the production UI at desktop/narrow
widths. They protect consequential behavior rather than matching markup.
