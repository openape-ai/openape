# OpenApe Pods

M1 delivers the macOS desktop foundation for the selected pod workspace concept B. It uses Electron 40.9.3, Vue 3, TypeScript and Vite. This build is always in fixture mode: it has no mailbox connection, Codex invocation, resource grants, script execution or scheduling. The displayed worker state comes from a real Electron utility process.

## Run and verify

From the repository root, activate the pinned toolchain with `. ./scripts/activate-node.sh` and install using `pnpm install --frozen-lockfile`.

```sh
pnpm --filter @openape/pods dev
pnpm --filter @openape/pods lint
pnpm --filter @openape/pods typecheck
pnpm --filter @openape/pods build
pnpm --filter @openape/pods test
pnpm --filter @openape/pods package:mac
pnpm --filter @openape/pods test:e2e
pnpm --filter @openape/pods report
```

`dev` builds once and opens Electron with bundled renderer assets; restart it after changing source. No HTTP development server or remote content is exposed. `package:mac` creates the unsigned arm64 development bundle at `release/mac-arm64/OpenApe Pods Fixture.app`. It runs with its own Node runtime and does not require system Node. Developer ID signing, hardened-runtime distribution configuration and notarization belong to M12; this is not a distributable release.

`test:e2e` requires macOS and an already built app/bundle. `test:packaged` selects packaged acceptance; `test:boundaries` selects the Electron renderer/IPC boundary checks. These do not claim pod script isolation, which belongs to M3. `test:layout` builds/packages and runs the complete Electron suite. It is registered in the shared `layout` contract, which runs on the macOS CI runner and locally as part of `check:ci`. No skipped Electron suite is presented as a passing release gate.

`report` creates a self-contained HTML evidence file with embedded screenshots at `.artifacts/foundation-report.html` after the Electron suite. Raw results stay in `.artifacts/electron-tests.json`.

## Fixture state and lifecycle

The default data directory is `openape-pods-fixture-<uid>` inside the OS temporary directory. `OPENAPE_PODS_FIXTURE_DIR` can select a private absolute test directory. The app checks directory ownership, private mode, leaf symlinks and its fixture marker before using it. No owner authentication cache is resolved. The trusted application is not an OS sandbox for arbitrary scripts; do not interpret this path guard as M3 enforcement.

Instances sharing that directory share Electron's single-instance lock. Closing the window hides it and keeps the worker/tray alive. Open Pods from the menu bar or launch the same instance again to restore it. Quit Pods asks the worker to stop, then kills it if it fails to stop within two seconds. Unexpected worker exit is shown as Needs attention; reopen the application for explicit recovery. There is no timer-based simulation of successful work.

The renderer has sandboxing and context isolation enabled and Node integration disabled. It receives only `getStatus()` and `onStatus()`. The main process validates the requesting web contents, top frame, exact application URL and absence of arguments. Only bundled assets use the custom `pods://app` protocol. A restrictive CSP, network filter, permission handlers and navigation/popup/webview/download guards block external effects. These are application foundation controls, not a replacement for the later per-pod OS boundary.

The worker receives an explicitly constructed environment with a fixture HOME/TMPDIR and fixed PATH. Secrets inherited by the desktop process are not forwarded. Its only protocol is readiness and shutdown; it does not invoke tools or accept execution requests.

## Dependencies and follow-up

Electron supplies desktop APIs and Node. electron-builder supplies the macOS development bundle; both versions passed the repository's seven-day publication quarantine at introduction. Vue/Vite/TypeScript are confirmed product dependencies; tsup bundles sandbox-compatible CommonJS main/preload/worker entrypoints. Vitest/Vue Test Utils verify state/contracts; Playwright drives actual Electron and captures light/dark/compact/error evidence. The established catalog supplies shared dependencies. No Bootstrap-Vue Vue 2 dependency is introduced into the confirmed Vue 3 application.

SQLite storage starts in M2. Resource/identity/snapshot enforcement starts in M3. SDK runs start in M4 and master integration in M10. M0's known o365 defects remain assigned to M8; signing and distribution remain M12 requirements.

- Issue: https://git.openape.ai/openape-ai/openape/issues/1348
- Plan: https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2A2ZV0AAPDW75YMD4TVG8Q5
- Dependency prerequisite: https://repos.openape.ai/patrick/monorepo/pulls/23
- Electron security guidance: https://www.electronjs.org/docs/latest/tutorial/security
- electron-builder 26 configuration: https://www.electron.build/v26/docs/configuration/
