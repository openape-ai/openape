# Testing OpenApe Pods

Every assertion lives on the lowest level that can answer its question. A packaged Electron launch costs seconds; a component test costs milliseconds. [Issue 1374](https://repos.openape.ai/patrick/monorepo/issues/1374) moves the existing suite down this ladder; its plan is `.claude/plans/issue-1374-test-pyramid-pods.md` in the repository root.

| Level | Where | Answers | Runs in |
|---|---|---|---|
| Unit / functional | `test/**` (Node, happy-dom) | Pure functions, contracts, worker modules against real SQLite and files | `pnpm --filter @openape/pods test` (unit gate) |
| Component | `test/**/*-ui.test.ts`, `test/workspace.test.ts` (`@vue/test-utils` + happy-dom) | Vue states, branches, visible text, emitted bridge commands | unit gate |
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
| `agent.test.ts`, `master.test.ts`, `onboarding.test.ts` (Node case) | Pinned Codex binary and app-server confined by the sandbox |
| `external-shell.test.ts`, `external-session.test.ts`, `installed-applications.test.ts` | `ape-shell` from the package reaches real child processes; grant denial blocks the side effect |
| `o365.test.ts`, `broker.test.ts` | TLS against a real socket with the packaged helper; credential isolation between sandboxes |

## Moved in issue 1374

| Former E2E | Replacement |
|---|---|
| `pod-workspace.test.ts` | `test/layout/app-shell.test.ts` (7 views × 6 sizes × light/dark × en/de, source viewer, contextual chat), `test/workspace/shell-ui.test.ts` (arrow-key tabs, archived pod cannot run, Discuss knowledge, connections hidden), existing `test/workspace/ui.test.ts`, `test/resources/ui.test.ts`, `test/settings.test.ts`, `test/scheduling/ui.test.ts`, `test/workspace/description-ui.test.ts`, `test/workspace.test.ts` |
| `groups.test.ts` | `test/workspace/groups.test.ts` (persistence), `test/workspace/groups-ui.test.ts`, `test/workspace/shell-ui.test.ts` (drag and drop, Settings group), `test/layout/app-shell.test.ts` (long group name wraps, with counter-check) |
| `language.test.ts` | `test/i18n/language.test.ts`, `test/i18n/ui.test.ts`, `test/layout/app-shell.test.ts` (German views, language switcher in a narrow window); native menu and dialog labels in `foundation.test.ts` |
| `foundation.test.ts` (unpackaged arms, scheduling, storage, layout) | Packaged arms kept; `test/workspace/shell-ui.test.ts` (concurrency limit), `test/workspace/script-authority.test.ts` (unknown create keys rejected), `test/storage/database.test.ts` (reopen), `test/layout/app-shell.test.ts` (empty profile light/dark, 880 × 640) |
