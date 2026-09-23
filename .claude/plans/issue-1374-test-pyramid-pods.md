# Plan: Pods test pyramid — move Electron E2E assertions down

Status: **approved by Patrick 2026-09-23** (D1–D4 as recommended; D3 revised: no production code change, no dependency on Sessions A/C).

Issue: https://repos.openape.ai/patrick/monorepo/issues/1374 (gate strategy: issue 1364, component-test policy: issue 1172).
Worktree: `openape-monorepo.worktrees/issue-1374-test-pyramid`, branch `feature/issue-1374-test-pyramid-pods`, base canonical main `dc466549`.

## Purpose / Big Picture

- **Goal:** the `@openape/pods` layout step spends its time only on questions that nothing but a packaged app or a real native process can answer. Vue behaviour moves to happy-dom component tests, geometry/CSS/breakpoints/dark mode to Vitest browser mode, worker logic to functional tests. No consequential contract loses its proof.
- **Context:** Patrick wants CI runs to be fast; per issue 1364 the pods layout step dominates the full gate.
- **Scope:** `apps/openape-pods/e2e/**` (35 test files + `o365-setup.ts` global setup = the "36 files"), the matching `test/**` suites, a new browser-mode config, `scripts/report.mjs`/`scripts/handbook.mjs` inputs, and a testing doc. **Not in scope:** `@openape/pods-ios` native step (issue 1364 step 5), CI workflow selection (1364 steps 1–2), other workspaces.

## Repo orientation

- `apps/openape-pods/vitest.config.ts` — happy-dom unit/component suite, `test/**/*.test.ts` (84 files). Runs in the unit gate.
- `apps/openape-pods/vitest.electron.config.ts` — `e2e/**/*.test.ts`, `fileParallelism: true`, `maxWorkers: 3`, global setup `e2e/o365-setup.ts`. Runs via `test:layout` = `pnpm build && pnpm package:mac && pnpm test:e2e` in the `layout` suite (`.openape/checks.json`, `scripts/check.mjs`), on the shared mac runner.
- Template for browser mode: `apps/openape-troop/vitest.browser.config.ts` + `tests/layout/`. Pods differs from troop in a helpful way: its CSS is its own (`src/renderer/style.css`, imported by `src/renderer/main.ts`, plus a `<style>` block in 27 SFCs; breakpoints at 1030/800/760/600 px). There is no Tailwind, so a browser-mode test measures the real production CSS.
- Component-test pattern: `test/workspace.test.ts` mounts `App.vue` with a `window.pods` stub; the same stubs work in browser mode.
- Evidence scripts (manual, not in any gate): `scripts/report.mjs` reads 40 fixed screenshots from `.artifacts/` and throws if one is missing; `scripts/handbook.mjs --refresh-images` copies 24 `handbook-*-{en,de}.png`.

### Two kinds of "E2E" file

Only 20 of the 35 files launch the packaged Electron app through Playwright. The other 15 are plain Node tests that live in `e2e/` because they need the built native helper (`dist/native/pods-helper`, `sandbox-exec`), the pinned Codex binary, the packaged `ape-shell.mjs`, a real PTY or a real TLS socket. No test under `test/**` touches the helper. They are native-boundary tests, not UI tests, and most of them must stay (decision D1).

## Measurements (before)

Command: `pnpm --filter @openape/pods test:e2e` after `build` + `package:mac`, local Mac (M-series), 2026-09-23 08:22, source `dc466549`, runner queue idle.

- **135 tests / 35 files, all green. Wall 72.6 s** (3 workers). Sum of per-file time 205.9 s. Build 3.9 s + fixture package 5.3 s before that.
- Issue 1364's 214 s was measured before `fileParallelism` landed; step 3 of 1364 is already on main.

Per-file times are in the table below (vitest JSON reporter, `.artifacts/electron-tests.json`).

## Decision per file

Legend: **E** = launches packaged Electron, **N** = Node + native helper/binaries. "After" is an estimate; every PR records the measured value.

| File | Kind | Tests | s before | Decision | Stays E2E (why nothing lower can answer) | Moves / replacement (named) | s after (est.) | PR |
|---|---|---|---|---|---|---|---|---|
| agent | N | 9 | 9.1 | **Keep** | Real pinned Codex + SDK host under `sandbox-exec`: streaming (both packaged arms), built-in tool denial, cancellation of a supervised process | — (gateway logic already in `test/agent-gateway.test.ts`) | 9.1 | — |
| broker | N | 6 | 3.7 | **Split** | Sibling credential unreadable + child spawn denied in sandbox (both arms); o365 over real TLS with packaged helper | Pre-launch rejections (foreign identity, capability expansion, stale lease, changed artifact, `executions === 0`), UTF-8 chunk decoding, revocation polling + plaintext removal → new `test/credentials/broker.test.ts` (functional, `vi.mock` of `launchSandbox`, grant server fixture from `test/grant-authorization.test.ts`) | 3.0 | 5 |
| chat-setup | E | 1 | 1.5 | **Delete** | — | BotFather text + "Continue setup" disabled on empty draft → `test/master/setup-ui.test.ts`; 560 px dark German composer/`.chat-access` → browser `test/layout/master-chat.test.ts`; secret never in chat view already `test/master/setup.test.ts` (2 tests) + `test/master/ui.test.ts:44`. Native dialog gating in `app.ts:204-217/305` stays unproven below E2E until M6 (see D3) — kept in `programs` packaged test | 0 | 2 |
| chats | E | 1 | 6.0 | **Trim** | Real Codex app-server: after a context change the provider request body no longer contains earlier private context | Rename → `test/master/chats-ui.test.ts` + `ChatRegistry.rename` in `test/workspace/chat-registry.test.ts`; run-once receipt → `test/workspace/chat-changes.test.ts`; 1060/760/560 + dark → browser `test/layout/master-chat.test.ts`; review/apply/context already in `chat-changes`, `chat-registry`, `chats-ui` | 4.5 | 2 |
| crash-recovery | E | 6 | 23.2 | **Keep** (trim in M6) | Termination arms `worker/app/quit/script`: real SIGKILL/quit + relaunch + `inspect-domain`, no duplicate unit | M6 only: storage-limit cancel and suspend/resume gate after extracting the tick from `src/worker/entry.ts:105-134` → `test/data/backup.test.ts`, `test/scheduling/scheduler.test.ts` | 23.2 (→ ~19 after M6) | 6 |
| credentials | E | 1 | 4.4 | **Trim** | Real macOS `safeStorage`: ciphertext has no plaintext, decrypts after restart, `userData` in fixture root | Masked field/clear, approval UI already `test/credentials/ui.test.ts`; per-pod alias/binding already `test/credentials/cache.test.ts:8`, `authority.test.ts`; revoke → schedule blocked → `test/credentials/authority.test.ts`; 560 dark `.script-access` overflow → browser `test/layout/pod-tabs.test.ts`. Rotation/revoke key erasure (`src/main/worker.ts:272-292`) stays in this E2E until M6 | 3.0 | 3 |
| data | E | 2 | 7.0 | **Trim** | Packaged arm: startup reads `selected-profile.json`; restore while the worker refuses a newer DB (`app.ts:169`) until M6 | Unpackaged arm deleted (backup/restore data already `test/data/backup.test.ts` (3 tests), `test/data/update.test.ts`, `test/data/ui.test.ts`); 560 dark → browser `test/layout/pod-tabs.test.ts` | 3.5 | 4 |
| dependencies | E+N | 2 | 3.1 | **Convert + move** | Bare import resolves from read-only `dependencyRoot` inside the sandbox — as a Node test like `dispatcher` (no Electron) | Test 2 (hash per dependency set, approval retained) → `test/workspace/dependencies.test.ts` with mocked `executeScript`; search/prepare UI already `test/workspace/script-ui.test.ts` (2 tests); `.http-heading` gap → browser `test/layout/permissions.test.ts`; prepare-confirm dialog gating → M6 | 1.5 | 3 |
| dispatcher | N | 10 | 10.3 | **Split** | One real sandboxed run through `script-entry` frame protocol with variables, `credentials.get`, `progress.commit` and real Codex; secret reaches provider only when the script forwards it (trimmed `combines credential reads…`) | Lease/replay, provider absence, stale validation, rename → new `test/scheduling/dispatcher.test.ts` (`vi.mock` of `runner.executeScript` + `recovery/domains`); rotation cancel → `test/credentials/authority.test.ts`; HTTP reconciliation + `Recovery.resolveHttp` → `test/recovery/effects.test.ts`; mail preview → `test/mail/workflow.test.ts`; scope substitution already `test/credentials/authority.test.ts` | 2.5 | 5 |
| domains | N | 4 | 0.6 | **Keep** | Helper PID identity, PID reuse, registration gate — OS process semantics | — | 0.6 | — |
| external-session | N | 1 | 0.8 | **Keep** | Packaged `ape-shell` in a real PTY, token never printed, lease released | — | 0.8 | — |
| external-shell | N | 2 | 2.3 | **Keep** | Packaged `ape-shell -i` in a PTY; denied grant never writes its output file | — | 2.3 | — |
| foundation | E | 12 | 16.5 | **Split** | IPC/renderer boundary + worker env scrubbing; single instance + quit; packaged start **with Electron 40.9.3 / Node 24.14.1 and Vue rendered**; bundle icon; SIGKILL → alert; packaged manual run in sandbox; packaged reference snapshot; Help-menu report URL. Gains one assertion: German menu labels after language switch (replaces `language`) | Unpackaged arms of `resources`/`manual runs` deleted (same helper bytes); `scheduling` test → concurrency form in `test/scheduling/ui.test.ts`, rest already `test/scheduling/*`; `storage` UI/persistence already `test/storage/database.test.ts`, `test/settings.test.ts`, `credential` key rejection → `test/workspace/script-authority.test.ts`; `assignReference` renderer denial → parser unit in `test/storage/resources.test.ts`; ArrowRight/"Needs attention" → `test/workspace.test.ts`; light/dark/880×640 → browser `test/layout/app-shell.test.ts` | 11.0 | 1 |
| groups | E | 1 | 3.0 | **Delete** | — | Persistence already `test/workspace/groups.test.ts` (2 tests); drag-and-drop → `test/workspace/groups-ui.test.ts`; Settings group select → `test/settings.test.ts`; `.group-name` wrap at 560 dark → browser `test/layout/app-shell.test.ts` | 0 | 1 |
| handbook | Chrome+E | 3 | 6.8 | **Split** | Test 1 (×2 locales): generated offline HTML in system Chrome — static page, cheap, stays | Test 2 is a screenshot generator, not a check → moves out of the gate to `pnpm handbook:capture` (D2); its no-side-effect assertions are covered by the kept `foundation` tests | 2.0 | 4 |
| installed-applications | N | 3 | 4.2 | **Keep** | Packaged `ape-shell` reaches a real GUI child with pod context (approved/denied); bundle vendor layout | — | 4.2 | — |
| language | E | 1 | 4.7 | **Delete** | — | Persistence/catalogue already `test/i18n/language.test.ts`; live switch without remount already `test/i18n/ui.test.ts`; unsaved script survives already `test/workspace/script-ui.test.ts`; native menu German labels → one assertion in kept `foundation`; delete dialog German title → M6 (extract dialog options) — until then in `foundation`; switcher/tab overflow → browser `test/layout/app-shell.test.ts` | 0 | 1 |
| mail-knowledge | N | 4 | 5.9 | **Split** | Packaged parser in the bundle's sandbox (one document); golden recipe through script, SDK and parser | Plain/HTML/PDF/DOCX extraction and gap classification → new `test/mail/extraction.test.ts` (unit on `extract()`) | 4.0 | 5 |
| master-ui | E | 1 | 5.8 | **Delete** | — | Slash palette, model picker, decline, collapsed activity already `test/master/ui.test.ts` (5 tests), review `test/master/chats-ui.test.ts`; "selected model reaches provider" → Node test in `e2e/master.test.ts` (real app-server, no Electron); alignment/composer/palette in viewport/scroll-follow → browser `test/layout/master-chat.test.ts` | 0 | 2 |
| master | N | 13 | 11.7 | **Split** | Sandbox write escape, native validate+run, streaming (both arms), model-forced built-in denied, per-pod context at real app-server, runtime example, description, archive race. Gains: repair loop from `prompt-setup`, model ID from `master-ui` | "persists ordinary setup…" (scope, stale revisions, `requestAccess` refuses values, `inspect` redaction) and "adopts a creation turn…" → new `test/master/control.test.ts` (MasterControl with stub runtime, pattern `test/workspace/scripts.test.ts:18-28`) | 10.5 | 5 (+2) |
| o365 | N | 7 | 3.7 | **Keep** | Pinned o365 CLI in sandbox, TLS through a real proxy socket, fail-closed refresh/account/cancel | — | 3.7 | — |
| onboarding | E+N | 5 | 14.6 | **Split** | Test 1 (Node): real Codex `account/read` in the sandbox, `turn/start`/`command/exec` rejected | Tests 2–4 deleted: "packaged renders" already proven by `foundation`; `finish` → complete and broker consent survives reopen → `test/onboarding/control.test.ts`; "Continue to workspace" emits → `test/onboarding/ui.test.ts`; duplicate owners already `test/onboarding/reconcile.test.ts` + `control.test.ts`; identity/consent UI already `test/onboarding/ui.test.ts` (4 tests); sidebar avatar → `test/workspace.test.ts`; 560 dark → browser `test/layout/onboarding.test.ts` | 1.5 | 4 |
| pod-workspace | E | 2 | 10.6 | **Delete** | — | Knowledge/sources already `test/workspace/ui.test.ts` (2 tests); directory revoke `test/resources/ui.test.ts`; settings/description/resume/new pod already covered (5 tests named in analysis); "Discuss knowledge" → `test/workspace/ui.test.ts`; archived Run now disabled + ArrowRight → `test/workspace.test.ts`; hidden connection resource → `test/resources/ui.test.ts`; 5 sizes × 2 themes × 7 tabs + footer fit → browser `test/layout/app-shell.test.ts`; snapshot/run already in kept `foundation` | 0 | 1 |
| programs | E+N | 4 | 8.8 | **Split** | Two Node "program boundary" tests (sandbox read denial, grant consumption count, plaintext release on revocation); packaged test trimmed to: saved script invokes the app through worker → main broker → `ape-shell` with keychain, directory EPERM (also the remaining proof of native dialog gating) | HTTP grant boundary → `test/programs/http.test.ts` (functional, grant fixture); UI cards already `test/programs/ui.test.ts` (5 tests), `test/resources/ui.test.ts`; 560 dark + label width → browser `test/layout/permissions.test.ts` | 5.0 | 3 |
| prompt-setup | E | 1 | 3.7 | **Delete** | — | Repair loop (validation failure fed back, second draft) → `e2e/master.test.ts` (Node, native validation); staging/apply already `test/workspace/chat-changes.test.ts` (2 tests), `conversations.test.ts`; values-tab routing → `test/workspace.test.ts`; description label → `test/workspace/description-ui.test.ts`; 560 dark + German sidebar → browser `test/layout/master-chat.test.ts`; packaged sandbox run stays in `foundation` | 0 | 2 |
| readable-runs | E | 1 | 4.1 | **Delete** | — | Persisted failed/cancelled/pending states EN+DE → `test/runs.test.ts` (mount `PodRuns`); environment without secret → `visibleEnvironment` unit with a hostile key (the E2E check was vacuous: no secret was ever injected) + `test/workspace/script-ui.test.ts`; 600/680 px → browser `test/layout/pod-tabs.test.ts` | 0 | 3 |
| recovery | N | 1 | 1.4 | **Keep** | Lease held until a SIGSTOP-frozen supervisor actually stops | — | 1.4 | — |
| resources | N | 9 | 2.7 | **Keep** (−1) | Sandbox denial (cross-pod, auth file, fork, network, symlinks), packaged helper layout, crash/freeze of real processes | `verifyExecutable` hash mismatch → `test/remote/programs.test.ts` | 2.7 | 5 |
| scheduling | N | 2 | 0.8 | **Keep** | Real dispatcher completion frees scheduler slots; `ReferenceWatcher` fingerprints via native snapshot helper | — | 0.8 | — |
| script-editor | E | 1 | 8.4 | **Delete** | — | Save→validate→activate→start order, "Draft saved", reference expressions → `test/workspace/script-ui.test.ts`; sidebar resize/collapse/localStorage → `test/workspace.test.ts`; code-editor height, pointer drag, 560 dark → browser `test/layout/app-shell.test.ts`; failed validation never changes active script already `test/workspace/scripts.test.ts:39` + `e2e/master.test.ts`; run pins hash already `test/workspace/details.test.ts:33`. Tab screenshot loop feeds nothing (dead) | 0 | 3 |
| script-runner | N | 10 | 4.8 | **Keep** (−1) | Frozen input, protocol/time limits, cancellation, stalled service request, read-only packages — real child processes | Changed script artifact rejected before start → `test/workspace/runner-integrity.test.ts` (nonexistent helper path proves no spawn) | 4.7 | 5 |
| terminal | N | 5 | 3.6 | **Keep** (trim) | Real PTY resize/no-echo/Ctrl-C; revoked sessions keep host/snapshot/fork/shell denied; o365 over TLS, token never printed | Symlinked workspace preflight → `test/programs/terminal-preflight.test.ts`; encrypted state/pod binding asserts deleted (already `test/programs/state.test.ts:9`, `test/credentials/cache.test.ts:8`) | 3.5 | 5 |
| terminal-feedback | E | 1 | 1.0 | **Delete** | — | No-owner error → `test/onboarding/manager.test.ts`; `openShell` failure releases reservation → `test/programs/launch-startup.test.ts`; status/alert beside button already `test/programs/ui.test.ts:51` (+ German); alert offset ≤ 90 px → browser `test/layout/permissions.test.ts`. "Terminal.app not launched" was never asserted (only holds by code order in `app.ts:196`) — stays unproven, noted | 0 | 3 |
| values-tab | E | 1 | 1.2 | **Delete** | — | Empty variable/missing secret already `test/workspace/values-ui.test.ts:51`, `test/credentials/ui.test.ts:48`; German variant + Settings has no credential form → component; "declaring `credential.x` assigns nothing" → `test/workspace/scripts.test.ts`; empty value → `test/workspace/variables.test.ts`; 560 dark + row width > 160 → browser `test/layout/pod-tabs.test.ts` | 0 | 3 |
| workflows | E | 1 | 5.8 | **Delete** | — | Diamond order, members unchanged, pause/one-shot already `test/scheduling/workflows.test.ts:38,:100`; layers, mail toggle, German → `test/scheduling/workflow-ui.test.ts`; Space-key cycle toggle + 1060/760/560 node widths ≥ 170 → browser `test/layout/workflows.test.ts`. Native run of a single pod stays proven by `foundation` | 0 | 3 |
| o365-setup.ts | setup | — | — | **Keep** | Builds the o365 fixture used by `o365`, `terminal`, `broker` | — | — | — |

### Result (estimate, measured per PR)

| | before | after M1–M5 (est.) |
|---|---|---|
| E2E files / tests | 35 / 135 | 24 / ~75 |
| Files launching Electron | 20 | 6 (`foundation`, `crash-recovery`, `credentials`, `data`, `chats`, `programs`) |
| Sum of per-file time | 205.9 s | ~110 s |
| Wall-clock, 3 workers | 72.6 s | ~40 s (long pole: `crash-recovery` 23 s) |
| New browser-mode suite | — | ~8 files, ~3–5 s |
| Added component/functional tests | — | ~40 cases, < 3 s in the unit gate |

Honest limit: after this plan the remaining cost is mostly Node-level native-boundary tests (~60 s sum: sandbox, Codex, PTY, TLS). By the agreed criterion they stay. The next lever beyond this issue is splitting `crash-recovery`'s four arms into separate files so they run in parallel (≈ −15 s wall), offered as part of M6.

### Consequential contracts — where they are proven afterwards

| Contract | Proof after the change |
|---|---|
| Sandbox denial | `resources`, `terminal`, `script-runner`, `master` (write escape), `agent` (built-ins), `broker`, `programs` (Node boundary + packaged EPERM) |
| Credential isolation | `foundation` boundary (worker env scrubbed), `broker` (sibling unreadable, redaction), `dispatcher` (forwarding only by script), `external-session`/`terminal` (token never printed), `credentials` (safeStorage ciphertext), `test/credentials/*`, `test/master/setup.test.ts` |
| Grant consumption | `programs` Node boundary (`consumed === 3`), `installed-applications`, `external-shell` (denial), new `test/credentials/broker.test.ts` (`executions` 0/1), `test/grant-authorization.test.ts`, `test/programs/http.test.ts` |
| Crash recovery | `crash-recovery` termination arms, `recovery`, `domains`, `resources` (crash/freeze), `foundation` (SIGKILL alert), `test/recovery/effects.test.ts`, `test/storage/database.test.ts` |
| Native boundaries | `foundation` (IPC, packaged start, Node version, icon, single instance), `installed-applications`/`external-*` (packaged `ape-shell`), `o365`/`terminal` (TLS, PTY) |

## Open decisions (please answer before implementation)

- **D1 — Node-level native files stay in `e2e/`.** 15 files never launch Electron; they need built native artifacts. Recommendation: keep them there, move only their pure-logic cases down (M5). Alternative: a separate `test:native` suite — rejected, that is a new runner/chain change.
- **D2 — Evidence screenshots.** Deleting UI E2E removes ~30 of the 40 files `scripts/report.mjs` embeds and the handbook images. Recommendation: (a) browser-mode tests write the same-named screenshots to `.artifacts/` and report captions say "component with production CSS in Chrome"; (b) `handbook.test.ts` test 2 becomes `pnpm handbook:capture` (same code, `vitest.electron.config.ts` project filter), run when refreshing docs, not in the gate. Alternative: keep one ungated packaged "screenshot tour" for the report.
- **D3 — No production code change at all; no dependency on Sessions A/C (revised 2026-09-23 on Patrick's request).** The assertions that seemed to need extractions from `src/main/app.ts`, `src/main/worker.ts` and `src/worker/entry.ts` are tested against the **unchanged** modules instead: a Node functional harness with `vi.mock('electron')` imports the real `app.ts`, captures its `ipcMain.handle` handlers, `Menu.buildFromTemplate` templates and `powerMonitor` listeners, and drives them with fake dialog answers (worker/remote replaced by recording fakes). `FixtureWorker` (`worker.ts`) is exercised the same way with a real `CredentialCache` on a temp dir. `entry.ts` runs with a fake `process.parentPort` and fake timers; this one is the least certain and gets a spike first — if it is not viable, storage-limit/suspend stay in `crash-recovery` and the PR says so. Isolation rules: all PRs touch only `e2e/**`, `test/**`, configs, docs and `scripts/report.mjs`; new cases go into **new** test files inside the existing directories instead of editing test files A/C may also edit; before each PR `origin/main` is checked for merged changes to files being deleted and those are ported into the replacement.
- **D4 — Dev dependencies.** Browser mode needs `@vitest/browser` + `@vitest/browser-playwright` in `@openape/pods` (catalog versions, same as troop). No new runner; the existing `test:layout` script gets one more step.

## Milestones (one PR each, independently mergeable, each rebased early on main)

Every PR: (1) adds the replacement tests, (2) shows one **negative proof per moved area** in the PR body (break the rule/behaviour → the new test turns red → revert), (3) then deletes/trims the E2E, (4) records measured `test:e2e` wall/sum and browser-suite time, (5) updates `scripts/report.mjs` list and `apps/openape-pods/docs/testing.md`. Gates: `pnpm lint`, `pnpm typecheck`, pods unit suite, `pnpm --filter @openape/pods test:layout`. Check the shared mac runner (`/api/v1/repos/openape-ai/openape/actions/tasks`) before pushing.

### M1 — Browser-mode harness + workspace shell (files: `pod-workspace`, `groups`, `language`, `foundation` split)
1. `apps/openape-pods/vitest.browser.config.ts` (copy of troop's, viewport default 1060×800, include `test/layout/**/*.test.ts`); `vitest.config.ts` excludes `test/layout/**`; `test:layout` appends `vitest run --config vitest.browser.config.ts`.
2. `test/layout/setup.ts` imports only `src/renderer/style.css` — the file `main.ts` imports in production, no preflight of our own (CLAUDE.md rule "setup must not supply a rule the component carries").
3. `test/layout/app-shell.test.ts`: `App.vue` with `window.pods` stubs at 1440/1060/880×640/760/560, light + dark (`colorScheme`), all 7 tabs: no root/`.content` horizontal overflow, footer in viewport, `.group-name` wraps, language switcher inside viewport, sidebar pointer drag. Assertion that stubbed content is actually in the DOM (CLAUDE.md trap 2).
4. Component cases in `test/workspace.test.ts`, `test/workspace/groups-ui.test.ts`, `test/settings.test.ts`, `test/storage/resources.test.ts`, `test/workspace/script-authority.test.ts`, `test/scheduling/ui.test.ts` as listed in the table; German menu labels in `foundation`.
5. Delete `pod-workspace`, `groups`, `language`; trim `foundation`.
- **Negative proofs:** drop `overflow-wrap` from `.pod-button>span` → app-shell red; drop `@media(max-width:600px)` block → 560 case red; break ArrowRight handler → component red.
- **Acceptance:** `pnpm --filter @openape/pods test:layout` green; E2E wall recorded; `docs/testing.md` lists kept files + reasons.
- **Rollback:** revert the PR; nothing else depends on it.

### M2 — Chat surfaces (`master-ui`, `chat-setup`, `prompt-setup` deleted; `chats` trimmed; `master` gains two Node cases)
- Browser: `test/layout/master-chat.test.ts` (`MasterChat.vue`, `ChatsPanel.vue`, `ChatSetupReview.vue`): 1060/760/560, dark, German; composer and palette in viewport, user messages right-aligned, scroll-follow while reading vs. at bottom.
- Component: `setup-ui`, `chats-ui`, `chat-registry`, `chat-changes`, `description-ui`, `workspace.test.ts` cases from the table.
- Node: repair loop + selected model ID in `e2e/master.test.ts`.
- **Negative proofs:** remove the `.master-compose` max-width/flex rule → layout red; let repair loop skip feeding the validation error → master red; resend history on new thread (reset guard in `chat-registry`) → chats E2E red.

### M3 — Pod tabs (`values-tab`, `readable-runs`, `script-editor`, `terminal-feedback`, `workflows` deleted; `credentials`, `dependencies`, `programs` trimmed)
- Browser: `test/layout/pod-tabs.test.ts` (`PodValues`, `PodResources`+`ScriptAccess`, `PodRuns`+`RunApproval`, `DataManagement`, `ScriptCode` height), `test/layout/permissions.test.ts` (`ProgramPermissions`, `DirectoryPermissions`, alert offset, `.http-heading` gap), `test/layout/workflows.test.ts`.
- Unit/functional/component cases per table; `dependencies` test 1 rewritten as Node test.
- **Negative proofs:** return `SYNTHETIC_TOKEN` from `visibleEnvironment` → unit red; swap activate/validate order in `PodScript.prepareRun` → component red; widen `.workflow-node` min-width → layout red; remove `type=password` → `credentials/ui` red (already exists; shown once).

### M4 — Onboarding, data, handbook
- `onboarding` tests 2–4 deleted with replacements; `data` unpackaged arm deleted; `handbook` test 2 → `pnpm handbook:capture` (per D2); `test/layout/onboarding.test.ts`.
- **Negative proofs:** make `finish` a no-op → `onboarding/control` red; let broker consent default to true → control red.

### M5 — Node-level functional moves (`dispatcher`, `broker`, `master`, `programs` HTTP, `mail-knowledge`, `resources`, `script-runner`, `terminal`)
- New: `test/scheduling/dispatcher.test.ts`, `test/credentials/broker.test.ts`, `test/master/control.test.ts`, `test/mail/extraction.test.ts`, `test/workspace/runner-integrity.test.ts`, `test/programs/terminal-preflight.test.ts`; extensions per table. Seams are `vi.mock` of `worker/runs/runner`, `worker/recovery/domains`, `worker/runtime/sandbox` — no production change.
- **Negative proofs:** remove the pre-launch capability check in `src/main/broker/tools.ts` → broker functional red; drop `inspect` redaction → control red; accept a foreign origin in HTTP → http red; remove script hash check in `runner.ts:22` → runner-integrity red.

### M6 — Main-process harness (no source change; D3)
- New `test/main/app-harness.ts` (`vi.mock('electron')`, recording fakes for `FixtureWorker`/`RemoteController`) + `test/main/app.test.ts`: data dialogs (delete/backup/restore cancel vs. confirm, restore while worker is in error → `restoreBackup` + profile pointer), reference/HTTP/program/prepare dialogs (cancel assigns nothing), German menu + delete dialog labels, `openShell` failure never calls `open` (the claim `terminal-feedback` never proved), `powerMonitor` suspend/resume forwarded.
- `test/main/worker-credentials.test.ts`: rotation and revoke erase the old key file, the other pod's file stays (real `CredentialCache`).
- Spike: `entry.ts` with fake `parentPort` + fake timers for storage-limit cancel and suspend gate; move down only if it works.
- Then trim `crash-recovery`, `data`, `credentials`, `foundation` (menu) accordingly; split `crash-recovery` arms into separate files for parallelism.
- **Negative proofs:** make the delete dialog ignore the answer → app red; skip `erasePodKey` on rotation → worker red; drop the suspend check in the tick → entry red.

## Progress

- [x] `2026-09-23 08:23` Baseline measured (72.6 s wall / 205.9 s sum / 135 tests, all green).
- [x] `2026-09-23 08:40` File-by-file analysis against `test/**`.
- [x] `2026-09-23` Patrick's approval (D1–D4; D3 revised to "no production code change").
- [x] `2026-09-23 10:40` M1 implemented: E2E 35 → 32 files, 135 → 127 tests; `test:e2e` wall 72.6 → 57.9 s, per-file sum 205.9 → 166.5 s (two consecutive green runs); `foundation` 16.5 → 8.8 s. New browser suite 7 tests / 7.3 s; unit suite 362 → 369 tests. One of three full runs had a `chats.test.ts` timeout (Send stayed disabled); it passed 3/3 in isolation and 2/2 full reruns — flake under load, file is trimmed in M2.
- [ ] M2 … M6.

## Surprises & Discoveries

- 2026-09-23 — `fileParallelism` (issue 1364 step 3) is already on main; 1364's 214 s was serial. Evidence: `vitest.electron.config.ts`, measured 72.6 s wall.
- 2026-09-23 — 15 of 35 E2E files never start Electron; they are native-boundary Node tests.
- 2026-09-23 — `readable-runs` asserts `SYNTHETIC_TOKEN` is not shown, but never injects it → vacuous. `terminal-feedback` claims "without launching Terminal.app" but asserts nothing about it.
- 2026-09-23 — `handbook.test.ts` and `language.test.ts` both write the same `handbook-*` screenshots in parallel (last writer wins); `script-editor`'s tab screenshot loop feeds no script and contains an unreachable `Knowledge` branch.
- 2026-09-23 — Latest `layout` run on main (task 4914) is red; not investigated here (commit `caa139ab` names a terminal TTY flake on the shared runner).

- 2026-09-23 — M1 counter-proofs: of five CSS rules removed, three (`.main{min-width:0}`, `.content section{min-width:0}`, `.pod-button>span` wrap) left the E2E-equivalent views unchanged — the fixture data never needs them, and the former E2E had the same data. Removing `.value-row>div` wrapping produced a 4 px content overflow at 880 px and failed the new test; so does removing both wrapping and scrolling of the source `pre` (1089 px).
- 2026-09-23 — The former `pod-workspace` archived-pod check was vacuous: the archived pod had no active script, so Run now was disabled for that reason alone. The replacement gives it a script, and removing the lifecycle check turns it red.

## Decision Log

| Date | Decision | Reason | Rejected |
|---|---|---|---|
| 2026-09-23 | Browser tests run inside existing `test:layout` | Layout suite already runs on the mac runner with Chrome; no new runner | Separate `test:browser` suite in checks.json |
| 2026-09-23 | Plan approved by Patrick, D1–D4 as recommended | — | — |
| 2026-09-23 | No production code change in any milestone; Electron-bound main code tested via `vi.mock('electron')` harness | Patrick: no dependency on Sessions A/C, which edit `apps/openape-pods/src` concurrently | Extract handlers from `app.ts`/`worker.ts`/`entry.ts` (conflicts with A/C) |
| 2026-09-23 | New cases in new test files inside existing `test/` directories | Avoids merge conflicts with A/C on shared test files | Extending existing test files |

## Outcomes & Retrospective

(after completion)
