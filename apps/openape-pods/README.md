# OpenApe Pods

OpenApe Pods is the macOS desktop implementation of workspace concept B, using Electron 40.9.3, Vue 3, TypeScript, Vite and SQLite. This development build supports local pod assignments, reference snapshots and manual example scripts. Codex execution uses the pinned TypeScript SDK and native CLI with a synthetic transport in acceptance tests. Live provider connections, mail and automatic schedules are not enabled.

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

`test:e2e` requires macOS and an already built app/bundle. `test:packaged` selects packaged acceptance; `test:boundaries` selects the Electron renderer/IPC boundary checks. The native cases exercise the owner-accepted custom SBPL boundary; this is not an Apple-supported isolation guarantee. `test:layout` builds/packages and runs the complete Electron suite. It is registered in the shared `layout` contract, which runs on the macOS CI runner and locally as part of `check:ci`. No skipped Electron suite is presented as a passing release gate.

`report` creates a self-contained HTML evidence file with embedded screenshots at `.artifacts/foundation-report.html` after the Electron suite. Raw results stay in `.artifacts/electron-tests.json`.

## Fixture state and lifecycle

The default data directory is `openape-pods-fixture-<uid>` inside the OS temporary directory. `OPENAPE_PODS_FIXTURE_DIR` can select a private absolute test directory. The app checks directory ownership, private mode, leaf symlinks and its fixture marker before using it. No owner authentication cache is resolved. The trusted application is not an OS sandbox for arbitrary scripts; do not interpret this path guard as M3 enforcement.

Instances sharing that directory share Electron's single-instance lock. Closing the window hides it and keeps the worker/tray alive. Open Pods from the menu bar or launch the same instance again to restore it. Quit Pods asks the worker to stop, then kills it if it fails to stop within ten seconds. Unexpected worker exit is shown as Needs attention; reopen the application for explicit recovery. There is no timer-based simulation of successful work.

The renderer has sandboxing and context isolation enabled and Node integration disabled. It receives typed status, workspace, resource and run operations. The main process validates the requesting web contents, top frame, exact application URL and absence of arguments. Only bundled assets use the custom `pods://app` protocol. A restrictive CSP, network filter, permission handlers and navigation/popup/webview/download guards block external effects. These are application foundation controls, not a replacement for the later per-pod OS boundary.

The worker receives an explicitly constructed environment with a fixture HOME/TMPDIR and fixed PATH. Secrets inherited by the desktop process are not forwarded. The worker owns storage and dispatch. Renderer requests cannot supply executable paths, source code, provider endpoints or credential values.

## Dependencies and follow-up

Electron supplies desktop APIs and Node. electron-builder supplies the macOS development bundle; both versions passed the repository's seven-day publication quarantine at introduction. Vue/Vite/TypeScript are confirmed product dependencies; tsup bundles sandbox-compatible CommonJS main/preload/worker entrypoints. Vitest/Vue Test Utils verify state/contracts; Playwright drives actual Electron and captures light/dark/compact/error evidence. The established catalog supplies shared dependencies. No Bootstrap-Vue Vue 2 dependency is introduced into the confirmed Vue 3 application.

SQLite, resource boundaries and manual SDK runs are implemented through M4. Master integration belongs to M10. M0's known o365 defects remain assigned to M8; signing and distribution remain M12 requirements.

- Issue: https://git.openape.ai/openape-ai/openape/issues/1348
- Plan: https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2A2ZV0AAPDW75YMD4TVG8Q5
- Dependency prerequisite: https://repos.openape.ai/patrick/monorepo/pulls/23
- Electron security guidance: https://www.electronjs.org/docs/latest/tutorial/security
- electron-builder 26 configuration: https://www.electron.build/v26/docs/configuration/

## Durable local state (M2)

The worker owns `control.sqlite`, using the bundled Node SQLite API, WAL,
foreign keys and full synchronous commits. Settings creates paused local pods
and edits their versioned assignments. IPC accepts only the typed list/create/
update operations; it exposes no SQL, filesystem paths or credentials.

Scripts are content addressed with immutable manifests. Registering an artifact
does not activate it. Source blobs are flushed and atomically published before a
single transaction commits citations, append-only claims and the checkpoint.
Uncommitted blobs remain unreachable; retries cannot silently change a source
version or claim. Future-schema databases are rejected before modification;
migration preserves a pre-upgrade SQLite backup.

Verification: 19 unit/component tests, including four actual subprocess SIGKILL
points around blob/transaction publication, source conflicts, revision conflicts,
and v1 migration. Five Electron cases include save/restart/reopen and packaged
worker startup. The initial packaged worker failure exposed tsup stripping the
mandatory `node:sqlite` prefix; `removeNodeProtocol: false` fixes that path.

Scheduling, mail and connected master chat remain later implementation milestones. M2's local pod editor is a development
surface inside the selected workspace, not the completed onboarding flow.

## Native resources increment (M3A)

Resources offers a native file picker and an explicit owner confirmation before
assigning a read-only reference. The renderer cannot supply an assignment path.
The resource registry scopes each assignment to one pod and advances a persisted
permission epoch on assignment/revocation. Snapshot previews run through the real
worker in both development and packaged builds.

`native/pods-helper.c` traverses every source component with descriptor-relative
`openat` and `O_NOFOLLOW`, accepts bounded regular files, compares source identity
and metadata after copying, and flushes the result. Snapshot sets publish with an
atomic rename and a manifest of exact content hashes. This is per-file capture,
not an atomic transaction across unrelated source files. Scripts get access to
copies through the OS policy; file modes alone are not the access boundary.

The same helper supervises a separate process group, confirms group registration
before publishing its PID, and terminates a no-fork runtime when its controlling
lease closes or times out. Six native cases include packaged Electron-as-Node,
cross-pod/auth/symlink denial, reference write/fork/network denial, valid allowed
reads, frozen-process termination and actual controller SIGKILL. Scripts, Codex and assigned tools deny fork. The trusted SDK host may spawn the pinned Codex child in the supervised group; group cleanup retains the leader PID until live descendants have terminated. This does not claim arbitrary detached-daemon containment.
Custom SBPL remains the owner-accepted, unsupported native candidate from M0.

Credential cache support serializes refresh transactions per connection,
persists encrypted JSON atomically, removes tool-only plaintext on completion,
and retains a successfully rotated token when a subsequent read fails. Tests
use a clearly synthetic cipher and fake values. A macOS safeStorage adapter is
provided but no real Keychain/provider credential operation has been performed.
Actual broker delivery, identity provisioning and grant/revocation integration
are M3B. No script dispatcher or live connection is enabled by this increment.

Local evidence: 24 unit/component cases and 13 native/Electron cases. The
snapshot/revocation view was personally inspected in the packaged app. Full
repository gate evidence and native PR state are maintained in the linked plan.

## M3B: assigned identities and tool authorization

`PodIdentityManager` creates an encrypted per-pod Ed25519 key before requesting
an owner-scoped account. Retries retain that key, and token renewal signs a new
challenge as that exact pod. It has no ambient owner-key or global CLI-cache
fallback. The IdP route requires a human owner and an explicitly registered
atomic provisioning store; the Free IdP uses one SQL transaction for account
and key creation. Disabled or conflicting identities require explicit recovery.
The route creates no grants and does not invoke the normal safe-command seeder.

The `@openape/apes/assigned` entry reuses ape-shell's Shapes resolution and grant
verification, with fixed issuer, subject, host, adapter, operation and grant
bindings. It neither requests new grants nor installs adapters, invokes generic
fallback or executes shell text. The private app broker starts a separate native
tool sandbox after that check. Its first contract accepts exact assigned argv;
mailbox-specific parameter handling belongs to M8. Scripts must declare the
capability and retain a current resource/assignment lease.

Only the authorized tool gets its connection cache. Cache updates are serialized,
encrypted and flushed before cleanup, including refresh followed by a failed
read. The broker bounds execution time and output, redacts original/rotated cache
strings and polls identity/key/grant liveness during execution. Revocation or
an unavailable authority cancels the tool. These controls do not make arbitrary
third-party tools trustworthy: the assigned executable and entry files must be
pinned and reviewed. Production provider network access is still unwired.

Verification uses actual Ed25519 signatures, local HTTP IdP fixtures, SQLite
transactions, native deny-default policies and development/packaged Electron
runtimes. No real identities, Keychain items, provider credentials or grants have
been accessed. The existing resource UI remains the M3A view; script dispatch and
owner connection onboarding are M4 and M11.

The app adds only the existing `@openape/apes` workspace as a build dependency
for its narrowly exported assigned-command entry. No second grant engine or new
third-party authentication dependency is introduced.

## M4: manual runs and pinned Codex execution

Runs installs one of two bundled, content-addressed example versions and starts
it manually. A SQLite transaction reserves one lease per pod, pins the active
version and records the assignment/resource revisions. The runner freezes its
input, supplies read-only snapshots and uses a bounded, sequenced JSON protocol
on a private descriptor. Exit zero is insufficient: a valid terminal result is
required. Acknowledged knowledge/checkpoint commits and run events are durable.
Missing providers, malformed frames, timeouts and cancellation remain visible.
Restart fences unfinished work as interrupted; explicit reconciliation is M6.

Scripts and Codex run in separate deny-default native domains. Only the trusted
SDK host may launch the fixed CLI. Each regular agent call creates a fresh Codex
thread and private HOME. Built-in shell, patch, image and subagent facilities are
disabled; a restricted bundled model catalog removes the patch tool. The local
HTTP gateway exposes only ape_shell, rejects resource helpers and binds requests
to a random per-call capability. It forwards model transport through a trusted
provider callback, so provider credentials never enter the Codex environment.
The app's live provider callback is intentionally not connected yet.

SDK and CLI are pinned to 0.153.4. M0 used 0.154.0, but that release had not passed
the repository's seven-day publication quarantine on September 13. The compatible
mature version was selected without weakening quarantine. Builds extract the
catalog from that exact bundled binary, record hashes and ship the native CLI,
SDK host and script wrapper outside asar. Tests invoke the actual CLI/SDK with
recorded local Responses streams; they do not call a real model or use owner auth.

The complete development and packaged acceptance includes fresh thread IDs,
allowed ape_shell routing, forced forbidden built-ins, capability isolation,
script protocol failures, stalled provider cancellation, group cleanup, ordered
replay and real manual-run UI. Authenticated provider streaming and signed
release acceptance remain separately authorized gates.
