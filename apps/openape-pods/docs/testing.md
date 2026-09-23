# Testing OpenApe Pods

Every assertion lives on the lowest level that can answer its question. A packaged Electron launch costs seconds; a component test costs milliseconds. [Issue 1374](https://repos.openape.ai/patrick/monorepo/issues/1374) moves the existing suite down this ladder; its plan is `.claude/plans/issue-1374-test-pyramid-pods.md` in the repository root.

| Level | Where | Answers | Runs in |
|---|---|---|---|
| Unit / functional | `test/**` (Node, happy-dom) | Pure functions, contracts, worker modules against real SQLite and files | `pnpm --filter @openape/pods test` (unit gate) |
| Component | `test/**/*-ui.test.ts`, `test/workspace.test.ts` (`@vue/test-utils` + happy-dom) | Vue states, branches, visible text, emitted bridge commands | unit gate |
| Main process | `test/main/**` (Node, `vi.mock('electron')` via `test/main/app-harness.ts`) | The unchanged `src/main/app.ts`: IPC sender checks, native dialog gating, menus, power events — which worker command an owner's answer produces | unit gate |
| Layout | `test/layout/**` (Vitest browser mode, installed Chrome) | Widths, overflow, breakpoints, dark mode — with `src/renderer/style.css` and every SFC `<style>` loaded | `test:browser`, part of `test:layout` |
| Native / packaged | `e2e/**` (Playwright Electron, native helper) | Only what needs the packaged app or a real OS boundary | `test:e2e`, part of `test:layout` |

## Rules

- Vue behaviour goes to a component test. Assert visible text and the exact bridge command, not CSS classes.
- Anything with a size, a position, a breakpoint or a colour scheme goes to `test/layout`. happy-dom computes no layout.
- `test/layout/setup.ts` imports only the production stylesheet. Never add a rule there that a component should carry itself; it would hide the loss of the real rule.
- Dark mode in `test/layout` sets `color-scheme: dark` on the root element. The stylesheet uses `light-dark()` tokens, so this is the same switch the system preference makes.
- Every moved assertion needs a counter-proof: break the rule or behaviour, watch the test turn red, restore it. A layout test that stays green when its rule is removed measures something else.
- Screenshots that `scripts/report.mjs` embeds keep their file names. Browser-mode images are marked `test/layout` in their caption.

## Packaged E2E that remains, and why

These are the questions no lower level can answer. Files under review in issue 1374 are not yet listed.

| File | Why it needs the packaged app or a real process |
|---|---|
| `foundation.test.ts` | Packaged start with Electron 40.9.3 / Node 24.14.1 and rendered Vue; bundle icon; renderer/IPC boundary and worker environment scrubbing; single instance and quit; worker crash detection; packaged manual run in the sandbox; packaged reference snapshot; native menus and delete dialog in German; Help-menu report URL |
| `crash-recovery.test.ts` | Real SIGKILL/quit of worker, app and script, relaunch and domain inspection without duplicate work |
| `recovery.test.ts`, `domains.test.ts` | Supervisor lease, PID identity and PID reuse of real processes |
| `resources.test.ts`, `script-runner.test.ts`, `terminal.test.ts` | Sandbox denial (files, fork, network, shell), real TTY, time limits |
| `agent.test.ts`, `master.test.ts`, `master-chat.test.ts`, `onboarding.test.ts` (Node case) | Pinned Codex binary and app-server confined by the sandbox; native draft validation; chat repair loop, model choice and context reset as the provider actually receives them |
| `external-shell.test.ts`, `external-session.test.ts`, `installed-applications.test.ts` | `ape-shell` from the package reaches real child processes; grant denial blocks the side effect |
| `o365.test.ts`, `broker.test.ts` | TLS against a real socket with the packaged helper; credential isolation between sandboxes |
| `credentials.test.ts` | Real macOS `safeStorage`: ciphertext never contains the value, decrypts after a restart, key files erased on rotation and revocation, other Pods' keys kept |
| `programs.test.ts` (packaged case) | Keychain-backed program state, the folder dialog path and a saved script reaching the application through worker, main broker and `ape-shell`; a read-only folder refuses writes |
| `dependencies.test.ts` | A bare import resolves from the prepared, read-only library inside the sandbox (Node, no Electron) |

## Moved in issue 1374

| Former E2E | Replacement |
|---|---|
| `pod-workspace.test.ts` | `test/layout/app-shell.test.ts` (7 views × 6 sizes × light/dark × en/de, source viewer, contextual chat), `test/workspace/shell-ui.test.ts` (arrow-key tabs, archived pod cannot run, Discuss knowledge, connections hidden), existing `test/workspace/ui.test.ts`, `test/resources/ui.test.ts`, `test/settings.test.ts`, `test/scheduling/ui.test.ts`, `test/workspace/description-ui.test.ts`, `test/workspace.test.ts` |
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
| `workflows.test.ts` | `test/scheduling/workflow-graph-ui.test.ts` (graph saved by the real `WorkflowEngine`, layers, German mail policy), existing `test/scheduling/workflows.test.ts` (order, unchanged members, pause/one-shot), `test/layout/workflows.test.ts` (node widths at 1060/760/560, keyboard cycle refusal) |
| `dependencies.test.ts` (packaged editor case) | Node import case above, `test/main/app.test.ts` (preparation dialog), existing `test/workspace/script-ui.test.ts` (search/add/remove), `test/layout/pod-tabs.test.ts` (`.http-heading` spacing) |
| `credentials.test.ts`, `programs.test.ts` (UI and layout parts) | `test/layout/pod-tabs.test.ts`, existing `test/credentials/ui.test.ts`, `test/programs/ui.test.ts`, `test/main/app.test.ts` (program picker) |
