# OpenApe Pods

OpenApe Pods is the macOS desktop implementation of workspace concept B, using Electron 40.9.3, Vue 3, TypeScript, Vite and SQLite. This development build supports local pods, reference snapshots and manual example scripts. Codex execution uses the pinned TypeScript SDK and native CLI with a synthetic transport in acceptance tests. Owner-driven ChatGPT and OpenApe connection flows are implemented; third-party accounts are configured in assigned applications; live provider and tenant acceptance remain unverified. Schedules default to disabled, and new pods are paused.


## Installed applications and owner setup

Permissions presents assigned applications as a selectable icon/name list with
Play controls, a plus/minus toolbar and one Terminal.app button above it. Play
starts the verified executable directly through ape-shell with no arguments.
The application gets the pod workspace and its private application HOME, shared
with the existing encrypted setup state; Electron's Node-mode variable is removed.
The default macOS login Keychain stays in use. Selecting a row enables removal
with the minus control. The UI omits command-grant inventories, script snippets,
application import/replacement controls and the extra tool script-access selector.
Grants remain checked at execution time; removing these UI controls does not
change application assignments, stored state or runtime authorization.
The Play permission includes the executable hash, so replacing its binary cannot
silently reuse an earlier launch grant.

This is owner-assisted setup with Mac user privileges, not a GUI sandbox.
An app may ignore HOME, use a global profile/Keychain, or delegate to an existing
instance. Check its account in its own UI. Only foreground applications that use
the supplied context can share pod setup reliably; arbitrary detached descendants
are not contained. Close the application normally to save setup; forced stopping
or interrupted sessions do not publish setup changes. The current encrypted
application state limit is 4 MB / 128 files; large browser profiles need a separate
supported state strategy. Automated script confinement remains unchanged.



## External pod terminal

Permissions has one **Open Terminal.app** button per pod. It opens the real macOS
application with the bundled ape-shell, a pod-specific HOME, the pod workspace
as cwd, and the pod agent identity. Shell startup does not read the Mac owner's
profile. Assigned application commands are on PATH; their wrappers reuse the
existing encrypted per-application state, materialized only during setup.
Exit the shell cleanly to persist setup for later `context.tools.invoke` calls.
An open shell reserves the pod and pauses automation; closing it does not resume
automation. No account status is inferred.

Saved Node.js `run(context)` artifacts also start through the bundled ape-shell,
using the same HOME/cwd/SHELL and a preserved descriptor-3 result channel. The
selected source hash is checked before launch. The existing macOS script sandbox
and assigned-tool broker remain in place behind the shell grant.

The interactive setup shell is a grant-mediated owner shell, not an OS sandbox.
A granted command has the Mac user's filesystem/process privileges. Broad session
grants therefore permit broad shell commands; detached/background child lifetime
is not certified. The previous detached-child G0 is not declared solved. The
script broker still supports bounded foreground native CLIs.

Pod HOME is `pods/<id>/home` and work files live in `pods/<id>/workspace` under the
profile. Application setup uses its own protected HOME and the existing macOS
safeStorage/login-Keychain mechanism. Shell HOME/history and authentication state
are excluded from exported backups; durable work files belong in the workspace.
The CLI/native PTY are packaged, so no global Node or ape-shell install is needed.

Harmless acceptance cases: `external-shell.test.ts` verifies shared files, HOME,
cwd, streaming progress and denied execution; `external-session.test.ts` exercises
the actual external client through a PTY and encrypted setup persistence.
`programs.test.ts` covers the packaged button and setup-to-script broker handoff.
Terminal.app itself is excluded from this session's computer-use tool; no claim
of a verified native Terminal.app window screenshot is made.

Managed Pod shells ignore ape-shell user configuration in the writable HOME (`APES_IGNORE_USER_CONFIG=1`) and skip bash profiles. Otherwise a script-created pending-grant notification hook could execute outside the script sandbox before approval. Authentication still comes from the protected per-session Pod identity. Ordinary apes CLI configuration is unchanged.

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

`dev` builds once and opens Electron with bundled renderer assets; restart it after changing source. No HTTP development server or remote content is exposed. `package:mac` creates the unsigned arm64 development bundle at `release/mac-arm64/OpenApe Pods Fixture.app`. It runs with its own Node runtime and does not require system Node. M12 also supplies explicit signed-candidate/release pipelines and an unsigned DMG; release acceptance remains pending.

`test:e2e` requires macOS and an already built app/bundle. `test:packaged` selects packaged acceptance; `test:boundaries` selects the Electron renderer/IPC boundary checks. The native cases exercise the owner-accepted custom SBPL boundary; this is not an Apple-supported isolation guarantee. `test:layout` builds/packages and runs the complete Electron suite. It is registered in the shared `layout` contract, which runs on the macOS CI runner and locally as part of `check:ci`. No skipped Electron suite is presented as a passing release gate.

`report` creates a self-contained HTML evidence file with embedded screenshots at `.artifacts/foundation-report.html` after the Electron suite. Raw results stay in `.artifacts/electron-tests.json`.

## Fixture state and lifecycle

Normal launches use `~/Library/Application Support/OpenApe Pods`. `OPENAPE_PODS_FIXTURE_DIR` explicitly selects a separate private absolute test directory. The app checks directory ownership, private mode, leaf symlinks and its fixture marker before using it. No owner authentication cache is resolved. The trusted application is not an OS sandbox for arbitrary scripts; do not interpret this path guard as M3 enforcement.

Instances sharing that directory share Electron's single-instance lock. Closing the window hides it and keeps the worker/tray alive. Open Pods from the menu bar or launch the same instance again to restore it. Quit Pods asks the worker to stop, then kills it if it fails to stop within ten seconds. Unexpected worker exit is shown as Needs attention; reopen the application for explicit recovery. There is no timer-based simulation of successful work.

The renderer has sandboxing and context isolation enabled and Node integration disabled. It receives typed status, workspace, resource and run operations. The main process validates the requesting web contents, top frame, exact application URL and absence of arguments. Only bundled assets use the custom `pods://app` protocol. A restrictive CSP, network filter, permission handlers and navigation/popup/webview/download guards block external effects. These are application foundation controls, not a replacement for the later per-pod OS boundary.

The worker receives an explicitly constructed environment with a fixture HOME/TMPDIR and fixed PATH. Secrets inherited by the desktop process are not forwarded. The worker owns storage and dispatch. Renderer requests cannot supply executable paths, source code, provider endpoints or credential values.

## Dependencies and follow-up

Electron supplies desktop APIs and Node. electron-builder supplies the macOS development bundle; both versions passed the repository's seven-day publication quarantine at introduction. Vue/Vite/TypeScript are confirmed product dependencies; tsup bundles sandbox-compatible CommonJS main/preload/worker entrypoints. Vitest/Vue Test Utils verify state/contracts; Playwright drives actual Electron and captures light/dark/compact/error evidence. The established catalog supplies shared dependencies. No Bootstrap-Vue Vue 2 dependency is introduced into the confirmed Vue 3 application.

Storage, resource boundaries, scheduling, recovery, mail knowledge and master chat are implemented. Connection setup, explicit local deletion, backup/restore and manual update checks are implemented and verified with synthetic cases. Actual provider, tenant and signed distribution acceptance remain release gates.

- Issue: https://git.openape.ai/openape-ai/openape/issues/1349
- Plan: https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2A2ZV0AAPDW75YMD4TVG8Q5
- Dependency prerequisite: https://repos.openape.ai/patrick/monorepo/pulls/23
- Electron security guidance: https://www.electronjs.org/docs/latest/tutorial/security
- electron-builder 26 configuration: https://www.electron.build/v26/docs/configuration/

## Durable local state (M2)

The worker owns `control.sqlite`, using the bundled Node SQLite API, WAL,
foreign keys and full synchronous commits. Settings creates paused local pods
and edits their names with optimistic metadata revisions. IPC accepts only the typed list/create/
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

Mail and connected master chat remain later implementation milestones. M2's local pod editor is a development
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
version and records the execution binding/resource revisions. The runner freezes its
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

## M5: durable schedules and local events

Settings stores interval or daily schedules with a separate enabled flag, pod
pause/resume and a global concurrency limit (default two, range one to sixteen).
Pausing prevents new automatic dispatch and allows an existing run to finish.
Daily schedules name an IANA timezone, choose the first repeated wall-clock time
and move a missing time to the next available local minute. Interval schedules
retain their phase across clock jumps. Missed slots create one catch-up, with at
most one additional pending schedule event while a pod is already running.

Accepted events have source-specific idempotency keys and independent identities;
identical payloads with different keys remain distinct. Intake caps payloads at
32 KiB, pending/held inputs at 1,000 per pod and 10,000 globally, and batches at
50. A FIFO ready-pod dispatcher reserves events together with the run lease.
Only completed input IDs transition to processed with the terminal run commit.
Failed/incomplete inputs remain blocked for explicit recovery, preventing silent
loss and repeated automatic failure loops. Run history and Settings show backlog.

The worker rescans assigned references every fifteen seconds while a pod is
active, including the first tick after restart. Native descriptor-based capture
bounds reads; fingerprints and accepted change events commit together. Returning
to earlier bytes creates another generation/event. Scanning failures are visible
and retried; revoked references no longer participate. This records observed
changes, not every transient filesystem mutation between scans.

Verification uses a controlled clock with actual SQLite leases and real native
script execution. It covers DST, clock jumps, catch-up coalescing, duplicate and
conflicting event IDs, queue overflow, restart before acknowledgement, FIFO
capacity, held failures, cross-pod event binding and reference changes across a
database restart. Owner schedules remain unconfigured during implementation;
only isolated synthetic test profiles exercise automatic dispatch.

## M6: explicit recovery and lifecycle

Startup fences every retained run lease before accepting commands. Old workers
cannot register execution domains or commit progress. Native supervisors persist
process birth identities before opening the execution gate and publish a closed
record only after the owned process group is gone. Recovery inspects those
records; it never signals a saved PID. Missing or ambiguous process evidence
keeps the run blocked. A closed owning pipe prevents a late supervisor from
starting its executable after the worker has died.

Cancellation waits for actual SDK cleanup before releasing the pod and global
slot. Runs offers inspection and explicit retry using the latest validated
script and resources. Committed checkpoints and cited facts survive; remaining
inputs are requeued atomically with an idempotent recovery request. Each manual
request handles up to fifty inputs, with additional backlog visible for another
manual request. Paused pods stay paused.

The effect ledger records intent, completed receipts and unknown outcomes. An
unknown outcome prevents recovery until a trusted adapter reconciles it; scripts
cannot assert their own reconciliation. Effectful scripts remain disabled until
such an adapter is registered. This is tested with synthetic effects only.

Closing the window keeps a running fixture alive; quit cancels its process domain.
Suspend signals pause automatic intake and resume signals request a rescan and
coalesced catch-up. The tray can pause all automatic execution. Native and packaged
fixtures cover script/worker/app termination after a committed unit, no duplicate
knowledge after retry, stale PID identity, unknown effects and a frozen SDK
supervisor during cancellation. Synthetic power-monitor signals exercise resume;
physical macOS sleep/wake and signed-build acceptance remain unverified release
gates and are not implied by these tests.

## M7: concept B with persisted state

The current workspace uses Overview, Chat, Script, Permissions, Settings and
History. Overview shows the description, last execution and Run now. Results
and sources opens retained knowledge within Overview. The sidebar supports
pointer/keyboard resizing (176–360 px), persisted width and collapse.

Each pod has separate chat history and Codex continuation state. The workspace
chat retains legacy messages. Only one master turn runs across the app at a
time; regular pod runs still start fresh contexts. The existing master control
authority is retained; conversation separation does not add arbitrary host tools.

Permissions lists assigned file/tool resources; Settings owns ordinary variables
and managed secrets. General app/terminal launch remains blocked by the separate
G0 containment gate. No security boundary was relaxed for this UI change.


Component/SQLite tests cover hostile source text, exact historical citations,
foreign-source denial, immutable-version activation races and validation invalidation.
Packaged concept-B tests exercise selected-pod actions, source expansion, history,
expired/missing resource states, reference revocation, pod settings edits, manual
execution, pause/resume and archived inspection. Geometry checks and inspected
screenshots cover all five views at 1060×850, 760×700 and 560×700 in light/dark,
including keyboard tabs, horizontal overflow and a reachable fixed footer.


## M8 — Confined read-only mail integration

The historical o365 `pods` protocol is retained only as a synthetic test fixture
under `.artifacts/o365-fixture`. Production packages do not contain o365-cli,
its legacy runtime manifest or its CA bundle. Configure an installed executable
in Permissions and use that executable's supported commands. Old `context.mail`
scripts report an explicit migration error; their history and source are retained.
The currently installed Mac CLI uses `auth login` and `mail` commands, not the
historical `pods` protocol.

The following boundary description applies to the retained legacy protocol tests;
new pod assignments use the generic application broker.
Scripts and SDK calls share the declared tool capability and frozen run scope.
The main broker verifies the pod's signed ape-shell grant, holds a serialized
connection cache, registers the native domain with the worker before spawning,
and delivers credentials only to the separate tool sandbox. The script cannot
supply a cache path, executable, proxy, CA file or unassigned account/folder.
The broker's authenticated CONNECT endpoint permits only the fixed Microsoft
login and Graph hosts. The CLI additionally restricts methods, redirects,
projections and pagination paths. OAuth results must retain the requested account
and Mail.Read boundary after refresh.

The worker imports exact source blobs before returning bounded excerpts and
explicit continuation/completeness. This import does not advance the script's
checkpoint or claim that a business matter is processed. Claims and progress
still commit through the script contract. Full folder inventories and matter
processing use this protocol in M9. Onboarding assigns real identities, grants
and connections in M11; none were provisioned during implementation.

Synthetic tests exercise actual TLS, cache refresh across process restart,
non-mutating paginated reads, wrong accounts, invalid refreshes, cancellation,
foreign endpoints, traversal/symlink output, cache conflict/redaction, split UTF-8,
and native domain registration. A composed test combines the signed grant,
encrypted cache and actual packaged o365 binary against a local TLS fixture.
The fixture changes only its public CA snapshot and network dial target; product
code and the CLI binary are used directly. No live Microsoft request is made.
Provider streams now respect downstream backpressure and a 16 MiB response bound.

The upstream README declares MIT, but the source revision lacks its referenced
LICENSE file. The package records that missing notice explicitly; complete
license notices, Apple signing/notarization, physical sleep/wake, supported OS
coverage and live tenant/provider acceptance remain distribution gates.

## M9: sourced mail recipe

`mail-knowledge-v1` is a bundled, versioned read-only script. It inventories every
selected folder before analysis, checkpoints each durable page and continues a
bounded batch on the next run. Every subsequent run starts a fresh full inventory;
this intentionally favors correctness for moved old messages over an unproven
short lookback/delta optimization. A failed page retains its cursor. Stable item
IDs and immutable source snapshots are separate, so folder moves retain both
versions without a hash conflict. Permission or recipe changes
invalidate processing receipts. No owner schedule is enabled by installation.

The recipe uses `mail.next`, the existing SDK `agent.run`, and `mail.commit`.
Trusted host operations still use the assigned ape-shell authorization boundary.
Model calls retain the single effectful ape-shell gateway; they receive no new
filesystem, shell or credential access. Prepared contexts record source IDs,
parser fingerprints, current claims and omissions.
Provider conversation IDs group matters; missing IDs produce an association gap.
No subject-only merge is inferred. Selected sent folders participate in the same
inventory and can provide evidence that resolves an earlier question.

The proposed bounded defaults are ten messages and twenty current claim excerpts
per context, 48 KB of serialized evidence text, three attachments from the first
attachment page per message, twenty recipe units per run, 20 MiB per file and
100 MiB of attachment bytes per run. Omitted pages/documents, unsupported types,
truncation and uncertain association create explicit verification gaps. These
limits do not imply that omitted attachments have been examined. The model's
structured claims must quote supplied source text and may supersede only supplied
current claims from that matter. Quotes establish provenance, not semantic truth:
real model quality evaluation remains a separate acceptance gate.

Text/HTML/PDF/DOCX extraction executes in its own no-fork/no-network native sandbox,
with a 192 MiB V8 heap cap, 15-second process deadline, bounded input/output and
only the selected source plus pinned parser files readable. PDFs allow at most
100 pages; no rendering, XFA, WebAssembly, remote assets or OCR is enabled. DOCX
streams only `word/document.xml` in 1 KiB compressed chunks, with a 2 MiB expanded
text cap and no entity declarations. Unsupported, scanned, encrypted or malformed
sources remain unexamined gaps. The complete extracted source links back to the
original retained bytes in Knowledge; large raw previews are labelled truncated.

New pinned build dependencies are `pdfjs-dist@6.3.289` (Apache-2.0),
`html-to-text@10.0.1` and `fflate@0.8.3` (MIT). They replace unsafe ad-hoc document
parsing and have passed the repository quarantine. The PDF worker uses the
upstream legacy build's compatibility polyfills because pinned Node 24.15.0 lacks
`Uint8Array.toHex`, while Electron already supplies it. Both parser files are
checksummed and bundled; no system document converter is invoked. Existing
workspace dependency resolutions are preserved.

Verification: `test/mail/knowledge.test.ts` covers rule folders, sent resolutions,
attachment citations, hostile fabricated evidence, unsupported-only gaps,
contradictory dates, receipt rollback, permission changes and interrupted inventory.
`e2e/mail-knowledge.test.ts` exercises actual local/packaged parser processes and
the complete versioned script → SDK → parser → SQLite path with recorded model
outputs. UI tests follow extracted citations to original bytes. This is synthetic
fixture evidence, not a live mailbox or real-model quality claim.


## M10: confined master chat and reviewed actions

The master uses the pinned Codex 0.153.4 app-server over stdio. Build-time hashes
verify the nine experimental protocol schemas in
`runtime-sources/master-protocol.json`. The trusted relay belongs to the same
native guardian domain as its sandboxed Codex child. Codex can access only its
private conversation home, the pinned model catalog and the capability-bound
provider gateway. Built-in execution and unrelated tools remain disabled.
Only the typed `pods_control` dynamic tool reaches the control database.

SQLite schema 8 retains independent chat history, input identities, action
receipts, drafts and pending access proposals. Repeated completed actions return
their stored result; uncertain actions require inspection. Each new chat process
resumes its retained thread only after prior process domains are verified stopped.
Cancellation and provider failure remain visible, and availability is published
after process cleanup. The default limits are 20 actions and two minutes per turn,
1 MiB transport frames, 256 KiB action results and 100 visible recent messages.
Steering binds the expected active turn. The fixture provider is available only
through an explicit test-mode loopback port in a private fixture profile.

Draft validation executes the real native script boundary with empty synthetic
services and a five-second limit. Assignment, resource epoch, dependency lock and
draft revision bind its evidence and immutable artifact. Validation establishes a
bounded contract check; it does not prove arbitrary program semantics or real
model quality. Activation and rollback retain the previous version; permission
changes invalidate activation and automatic resumption. New resource access is
an exact owner-review proposal and cannot be approved by the model.

The workspace shows contextual input, action results, script code, validation
facts and readable account/folder/attachment proposals. ChatGPT/OpenApe/Microsoft
onboarding is described below. No real account or provider was used for
these tests.


## M11: account onboarding and exact mail scope

Normal first launch opens Connections & setup in a durable private profile.
The existing five pod views remain unchanged. ChatGPT model login, OpenApe human
identity and Microsoft Mail.Read consent are separate connections. The renderer
can select a provider, expected email and HTTPS OpenApe issuer, but cannot supply
tokens, executables or arbitrary provider endpoints. Browser opening uses only a
currently pending, driver-validated sign-in URL. No startup code logs in or reads
mail automatically.

The pinned Codex auth-only app-server accepts initialize, account/login/start,
account/login/cancel and account/read requests. Model turns and command requests
are rejected by its trusted transport. Its process domain is registered durably
before execution. Device sign-in uses the supported chatgptDeviceCode flow;
managed file credentials are isolated inside the encrypted connection transaction.
Refresh uses account/read with refreshToken=true. The unstable internal
chatgptAuthTokens interface is not used. Main owns provider authorization and
forwards bounded streaming responses through a capability gateway; neither the
utility worker nor the confined Codex child receives the account token.

OpenApe uses the existing apes-cli public client with PKCE S256 and the registered
http://localhost:9876/callback redirect. Callback method, host, path, state and code
are checked; Ed25519 signature, issuer, audience, human role, nonce, expiry and
expected email bind the returned identity. A busy callback port fails visibly.
The live identity service must allow this registered client/redirect; compatibility
has not been inferred from local source tests. Owner and model credentials remain
separate from each pod's generated Ed25519 agent identity.

Microsoft device sign-in and owner-requested folder inventory run the pinned
read-only Go CLI in a native sandbox with only their isolated writable cache and
public CA bundle. Folder traversal is bounded to 200 pages and 1,000 folders;
at most 100 can be assigned. The default history selection is 90 days, rounded to
a UTC calendar day; all history and attachments require explicit choices.
The reviewed upstream history change is ac04293166dda43ca35cc67bd77108d2fe6911c9,
merged through https://git.openape.ai/delta-mind/o365-cli/pulls/6. Message pagination
preserves the exact receivedDateTime boundary. An attachment parent must already
be recorded within that boundary. Existing durable knowledge is retained when
read permissions narrow.

The owner reviews account, folders, history, attachments and provider data use,
then confirms a native permission dialog. Only the per-pod agent requests grants;
only the human owner approves them. Already-approved reusable grants are handled
without an invalid second approval. A replacement revokes old resources, advances
the permission epoch, pauses the pod and cancels affected work. Shared connections
remain separate; disconnect invalidates every assignment that uses them. Existing
pod keys survive interrupted provisioning. Interrupted sign-ins become failed
on restart; a retry creates a separate isolated connection. Startup inspects old
authentication and tool domains before clearing abandoned plaintext cache files.

Verification covers 82 unit/component and 78 native/Electron cases, including the
actual auth-only Codex process, local and packaged setup, exact history/attachment
boundaries, owner-token signature checks, cancelled/retried sign-in, wrong account,
offline/expired login, locked store and wrong architecture. The UI was inspected
at desktop and 560px dark sizes. Native startup checks exposed an async readiness
race in two older tests; explicit status polling now covers the longer startup.
No actual browser sign-in, tenant, grant provisioning or model inference was used.
Physical sleep/wake, real authentication/refresh/provider compatibility, signed
release and clean-machine acceptance remain external gates. Pod deletion and
reachability cleanup are completed with M12 backup/retention, so this milestone
record does not claim those operations yet.

Pinned auth/provider source contract:
https://github.com/openai/codex/tree/rust-v0.153.4/codex-rs/login and
https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/core/src/client.rs.

## M12: data maintenance and distribution

Data & backups is available from the sidebar, including when a damaged/newer database
prevents normal startup. Exports use a quiescent SQLite `VACUUM INTO` snapshot and copy
only referenced source/script blobs, retained file snapshots and pod workspaces.
SHA-256, file size, source change detection, no-link paths, file/directory fsync and
atomic publication reject partial or corrupt copies. Limits are 100,000 files,
256 MiB per file/database and 10 GiB per export. A failed export keeps the last good
backup. Backups contain sensitive pod content but exclude the application credential
cache, login homes and execution capabilities. Scripts can themselves contain
owner-written sensitive literals; the exporter cannot identify those as credentials.

Restore verifies a backup in a new private profile and switches an atomic profile
pointer only after successful publication. The previous profile remains available;
normal quit/relaunch opens the restored profile. Connections are revoked, resources
require review, validations are discarded and schedules remain disabled. Running
work becomes interrupted and pending inputs require review. Older binaries reject a
newer database and can still restore a compatible backup through Data & backups.
Checksums detect corruption; an owner-selected backup is not authenticated by a
publisher signature. Treat imported backups as trusted owner data.

The default 10 GiB pod-data limit is configurable from 1 GiB to 1 TiB. Five-second
scans stop runs/master work at the limit or below 256 MiB of free disk space. Blob
publication checks available space first. This is a sampled application limit, not
a hard filesystem quota: active work can overshoot between scans. Chromium caches,
authentication files, external backups and previous profiles are separate from the
reported pod-data usage. Cleanup removes only unreachable blobs/snapshot staging;
all referenced evidence, committed history and pending events are retained.

An archived pod can be deleted after a native owner confirmation bound to its current
name and revision. Deletion journals pending filesystem/key cleanup, preserves shared
account connections and original reference files, and erases only keys bound to that
pod. Cleanup retries after restart or through Clean unused files. Global master chat
may retain earlier discussion of the pod. Remote OpenApe agents/grants remain visible
in OpenApe; local deletion does not use administrator APIs or claim remote revocation.

### Build artifacts and release gates

`pnpm --filter @openape/pods package:distribution` creates a versioned unsigned DMG
and app under `release/distribution`, with SHA256SUMS, a conservative runtime npm
closure, pinned native build metadata and collected license notices. No package is
uploaded. This local artifact is for evaluation, not a release. Its signed-manifest
flag is false and the manual updater rejects it as an approved update.

The current execution pilot is Apple silicon / Darwin 25.6.0 (verified locally on
macOS 26.6.2, build 25G83). Other kernel/CPU combinations show an explicit startup
error and cannot execute pods. The Electron packaging minimum of macOS 14 describes
the shell, not a tested execution support promise. Expand `main/support.ts` only
with recorded packaged boundary acceptance on the additional matrix entry.

`package:signed-candidate` and `package:signed` are opt-in pipelines. Neither ran in
this task. Both require explicit Developer ID identity and a preconfigured notary
keychain profile, plus an external review JSON selected by
`OPENAPE_PODS_RELEASE_REVIEW`, bound to the exact source SHA and dependency lock.
The checked-in `runtime-sources/distribution-review.json` is a pending template.
The licensed native/supplemental texts must be present at
`runtime-sources/licenses/REVIEWED-NOTICES.txt` with the reviewed SHA-256.
Candidates require license review; approved releases additionally require signed
boundary, clean-machine, actual provider/tenant refresh, physical sleep/wake and
OS/CPU evidence. This separation permits testing a signed candidate before approving
a release. The release review is an operator attestation, not an automated proof.

The signing pipeline signs the three native executables before packaging, updates
their runtime hashes, and prevents the packager from signing them a second time.
Electron receives only the JIT entitlement; there is no full-disk, root or App Sandbox
entitlement. The app is verified, notarized and stapled before DMG generation; the
DMG is then signed/notarized/stapled and checksummed. Actual hardened-runtime behavior
and entitlements remain unverified until the candidate suite runs with Developer ID.

The upstream o365 revision declares MIT without shipping LICENSE. Codex native Rust
and Go dependency notices and the build-host public CA bundle require redistribution
review. Npm metadata and collected text do not close those native license gates.
No invented license text or real signing/provider secret is included.

Manual update preparation uses fixed `codesign`, `spctl` and `plutil` calls to verify
both installed and candidate apps, the same Developer ID team, application identity,
a newer version and a compatible schema. It exports a pre-update backup and verifies
the candidate again. It never installs or launches the candidate. Quit before manual
replacement and keep the old app and backup together. For rollback, reinstall the old
signed app and restore its compatible backup into a fresh profile; never open the
migrated database with an incompatible old binary. No background updater, release
tag, publication or deployment is part of this increment.

## Direct script editor and user handbook

Read the [illustrated user handbook](docs/handbook.md) for every pod tab, global
view and the local script tutorial. `pnpm --filter @openape/pods handbook` builds
an offline, standalone `.artifacts/handbook.html` from `docs/handbook.json` and
reviewed screenshots. After the packaged `script-editor` scenario, pass
`--refresh-images` to deliberately refresh the committed illustrations.

The Script tab is a highlighted JavaScript source editor with direct saving and
Save and run. Saved unactivated work is reopened by default; visible version,
comparison and rollback controls are removed for V1. Internal source hashes,
assignment/resource validation, credential approvals and pinned runs remain.
Run saves and validates changed source, requires owner approval for secret access,
activates the exact hash and requests that same hash for immediate execution.
An occupied slot or pending inputs returns an error instead of queuing a later,
potentially different script. Failed validation preserves the active script.

Script, chat and ordinary form edits survive tab navigation within the session.
Stale script conflicts offer reload with discard confirmation or explicit saving
of local edits as the current artifact. No editor dependency is introduced.

Schema 13 adds per-pod ordinary variables and scoped chat metadata while retaining
legacy workspace chat. Variables are bounded plain strings, captured and frozen
as `context.variables` per run. They are included in backups; managed secrets
remain encrypted and excluded. Neither variables nor secret values are added to
model prompts automatically. A script can explicitly include values in a prompt.
Restore clears chat continuation IDs and requires explicit recovery. Older apps
must not open the migrated profile; use the matching pre-migration backup.

## Pod groups

The sidebar supports up to fifty named flat groups. Owners can create, rename,
collapse and remove groups, or move pods by dragging onto a group heading or
using Settings → Group. Removing a group keeps its pods under
Ungrouped. New pods are ungrouped; groups and pods retain creation order.

Schema 11 stores organization separately from pod assignment revisions. Group
changes preserve script validation, active versions, permissions and schedules.
A separate revision rejects stale organization writes. Group membership and
collapsed state survive restart and backup/restore; deleting a pod removes its
membership. Migration retains existing pods and creates a pre-migration SQLite
copy. Older binaries reject the newer schema; rollback requires a compatible
backup. See the handbook's grouping chapter for the owner workflow.

## Languages and handbooks

Open App settings in the sidebar and use Language / Sprache for immediate English/German switching. The profile stores the explicit choice in `language.json`; new profiles use German when the preferred system language is German, otherwise English. The renderer loads the choice before mounting, and the same choice updates native menus and app-owned dialogs. Display dates/numbers use `de-AT` or `en-GB`. Switching retains selected views and unsaved text. User content, script source, model prompts and raw audit payloads are unchanged. Known app diagnostics are translated; unknown external diagnostics retain their original text with a localized label. Restored profiles start with the system default because language is excluded from data backups.

The English source keys and German translations live in `src/i18n/de.json`; parameterized diagnostics are explicitly listed in `src/i18n/diagnostics.ts`. Add complete translations and identical placeholders when changing copy. Coverage tests check every static thrown diagnostic, visible template copy and handbook chapter parity. No translation network service or new runtime dependency is used.

Read the [English handbook](docs/handbook.md) or [German handbook](docs/handbook.de.md). Both have eighteen chapters and eleven locale-specific packaged-app screenshots. Run `pnpm --filter @openape/pods handbook` from the repository root to generate standalone `.artifacts/openape-pods-handbook.html` and `.artifacts/openape-pods-handbook.de.html`. Keep both files together for the edition links; images are embedded for offline use. Refresh images only after the packaged `e2e/language.test.ts` scenario with `pnpm --filter @openape/pods handbook --refresh-images`.


## Named script credentials

Resources stores named string secrets separately for each pod using the existing
macOS safeStorage encryption. `await context.credentials.get('crm')` reads the
pod's assigned value only when the script declares `credential.crm` and the owner
has approved its exact validated hash, current assignment and resource epoch.
The native review names the pod, aliases and full SHA-256. Master actions cannot
approve this access. The script editor preserves and edits these declarations.

Schema 12 extends resource kinds and records version approvals. Migration retains
existing resources and creates a pre-migration database copy. Rotation pauses the
pod and invalidates validation/approval; revocation cancels affected work and
removes the encrypted value. Startup reconciles interrupted saves using durable
metadata-only credential records. Pod deletion uses the existing deletion journal.
Backups exclude the credential store; restore clears approvals and requires values
to be assigned again. Roll back using a compatible pre-migration backup.

The credential broker uses a separate private script operation, verifies the pinned
run lease and declared alias before and after decryption, and never automatically
places values in inputs, environment, prompts, metadata or audit messages. Codex
still has only the assigned ape-shell gateway and cannot call credentials.get.
Existing shared provider OAuth tokens cannot be extracted through this API.
An approved script can explicitly include its readable secret in a prompt, log,
checkpoint or file. Synthetic validation uses fake values and is not a proof of
non-disclosure. Direct networking and process creation remain sandbox-restricted.
See the credential chapter in both handbooks for the workflow and complete example.

## Pod creation history and generated descriptions

A creation conversation has its own persisted identity. Its first successful create action binds it atomically to one Pod, including the initial request, streamed responses and subsequent actions. The UI follows that Pod, and later model actions are confined to it. A new creation session starts a separate conversation. Chat presents the immutable initial request separately from the recent timeline.

Overview's description is derived from completed owner/assistant exchanges by a separate, tool-free Codex app-server request. SQLite stores source boundaries, partial progress and the last successful description. Long histories and oversized messages are processed in ordered, bounded segments; interrupted updates can retry. Stale results cannot replace a newer requested description. Generation failures remain visible and preserve the last successful text. The description does not change script execution, invalidate scripts, grant access or enable schedules. Script execution and AI prompts are defined by the script; there is no separate execution assignment.

Schema 15 preserves existing data and adds creation bindings, original-request provenance, description progress and summary process ownership. Older unlinked creation history has an explicit, fingerprint-checked recovery preview. Recovery verifies the stored create result and rejects mixed-Pod, changed or active history. A recovered original request retains its identity and timestamp. Do not hand-edit the profile database to migrate a conversation.

Verification covers scoped creation/replay, preservation of the original request, stale summaries, long-message continuation, failure/retry, legacy adoption and actual packaged UI/App Server execution with recorded model responses. Real model quality and provider execution remain separately observable acceptance steps.

## Script authority and compatibility

Pod creation requires a name. Chat and the original request guide script creation; the script and its explicit AI prompts control execution. Settings has no separate execution assignment. Names are metadata: renaming preserves lifecycle, running work, script validation and credential approval. Overview descriptions remain informational. Pods without a conversation description link to Chat.

Schema 16 adds `pods.metadata_revision` for optimistic metadata updates. The historical `pods.revision` is retained as an immutable execution binding, exposed internally as `bindingRevision`. Existing manifest, run, validation and credential-approval fields named `assignmentRevision` or `assignment_revision` remain byte-compatible with their original bindings. They are not instructions and do not follow name edits. Old assignment text is retained only in historical storage, excluded from current Pod/tool responses and the legacy mail-knowledge analysis context. Permission epochs, exact-source validation, lease checks and revocation still apply. Migration does not revive artifacts invalidated before upgrade or rewrite script hashes.
