# M0a: macOS enforcement investigation

September 12, 2026. **Overall production gate: FAIL / not ready.**
The development policy matrix has **25 PASS and 1 FAIL**. The additional ad-hoc
signed App Sandbox helper matrix has **4 PASS and 3 FAIL**. The evaluated helper
does not meet the confirmed pod boundary. No supported production design has
passed M0a, and M1 remains blocked pending an enforcement design review.

## Scope and environment

- Owner authorized M0 with “wir können mit M0 loslegen.” M1+ remains gated.
- Canonical base: `db8d87cdbf67f6ac497a84004edebddc2f624240`.
- Isolated branch: `feature/issue-1346-pods-feasibility`.
- macOS 26.6.2, build 25G83, arm64; Node 24.15.0; pnpm 10.29.3.
- Native probe: local Xcode clang, `-Wall -Wextra -Werror -O2`.
- Mechanism tested: installed `/usr/bin/sandbox-exec`, development policy only.
- [Machine-readable evidence](evidence/boundaries.json) includes binary SHA-256,
  timestamps, exact exit results, process IDs and synthetic output. The runtime
  policy is generated from `src/profile.ts`, never accepted from pod input.

The harness did not read real mailbox data, retrieve a probe credential, call a
model, modify owner resources or activate a schedule. Ordinary repository and
plan-service authentication belongs to the authorized review workflow, outside
the probe. Neighboring checkouts and their work were preserved.

## Observations

All 26 unsandboxed controls succeeded. The sandboxed cases produced:

| Case group | Observed result |
| --- | --- |
| Workspace writes; snapshot reads through Node and native executable | PASS, 3 cases |
| Host-home, sibling-pod and app-DB content reads; outside writes | PASS, 4 denials |
| Snapshot write, chmod, rename, unlink and parent-directory write | PASS, 5 denials |
| Outside symlink read, snapshot symlink write, outside hard link | PASS, 3 denials |
| Native, absolute shell and Node grandchild outside reads | PASS, 3 denials |
| Unassigned executable and copied native executable | PASS, 2 denials |
| Assigned loopback service allowed; second loopback service denied | PASS, 2 cases |
| Already-open sensitive descriptor deliberately inherited | **FAIL: synthetic content remains readable** |
| Same control file, clean sandbox launch without inherited descriptor | PASS: EBADF |
| Workspace symlink replaced to point outside, then read | PASS: denied |
| Native grandchild launched in shell background and waited for | PASS: outside read denied |

Network evidence: the assigned listener received two connections (control and
sandbox); the denied endpoint received one (control only). These are TCP
loopback observations, not proof for DNS, IPv6, UDP, Unix sockets or the Internet.
The background case proves access inheritance while its parent waits. It does
not prove cancellation of detached or daemonized descendants.

The descriptor result is decisive: pathname restrictions do not revoke an open
file capability. The trusted launcher must close unassigned descriptors and
handles before starting a script, Codex or any tool. The clean-launch probe
demonstrates this specific mitigation. It does not prove that Electron/SDK/tool
launchers already implement it. Keep the unsafe control visible and failing.

Node initially aborted before the probe marker. Allowing a read of the root
directory itself (`literal "/"`, not a recursive root read) resolved startup.
A wildcard host-home allowance was not necessary. The policy currently allows
system runtime reads and general file metadata. Metadata disclosure and the
minimum packaged runtime filesystem surface still need a defined policy.

## Signed helper result

`pnpm test:helper` builds a minimal Foundation helper, creates two temporary app
bundles with different network entitlements, signs each with `codesign --sign -`,
and verifies each signature with `codesign --verify --strict`. This uses the
public App Sandbox entitlement mechanism without accessing a signing identity or
private key. **Ad-hoc signing is development evidence, not Developer ID or
notarization verification.** [Exact results](evidence/app-sandbox.json) include
binary/source/harness hashes, process IDs and controls.

| Required behavior | Actual result | Gate |
| --- | --- | --- |
| No unassigned host-file read | Synthetic outside file read denied with EPERM | PASS |
| Runner can write its App Sandbox container | First invocation wrote the synthetic pod-A canary | PASS |
| Fresh runner cannot read another pod's state | A second process with the same helper identity read that canary | **FAIL** |
| No unassigned host executable | `/usr/bin/true` executed successfully | **FAIL** |
| Runner without network entitlement cannot connect | Synthetic loopback connection denied | PASS |
| Assigned service usable when networking is enabled | First loopback service accepted the connection | PASS |
| Unassigned service remains inaccessible | Second loopback service also accepted the connection | **FAIL** |

All tested helpers reached their own process-start marker. Unsandboxed outside
read and loopback controls succeeded. Failures are observed successful accesses,
not malformed entitlements or startup crashes. The matrix reproduced on three
runs. Temporary app bundles, fixture data and the newly created unique helper
containers were removed; no login item, launch agent or system permission was
installed. The harness refuses pre-existing container identities.

A fresh process alone does not provide a fresh App Sandbox container. Two pods
using the same signed helper identity need a separate boundary for data placed
there. The client network entitlement is a Boolean permission, not a list of
assigned destinations. XPC can separate a trusted broker from a network-disabled
runner, but that fact does not fix shared-container or host-executable access in
this candidate. A different supported helper design remains possible; this result
does not claim an impossibility theorem about macOS.

## Supported mechanism comparison

| Candidate | Privilege ownership and potential fit | Evidence / gap |
| --- | --- | --- |
| `sandbox-exec` with an explicit per-process policy | Trusted parent computes file, executable and TCP endpoint rules. Script, native child and grandchildren inherit the restriction. | Development behavior measured above. Installed man page labels the tool deprecated; the SDK marks `sandbox_init` no longer supported. This cannot establish a supported shipping strategy. |
| Signed App Sandbox helper or XPC service | Electron/main broker retains app DB and credentials; a fresh isolated runner receives only its assigned workspace and snapshot access. Credentialed tools need separate trusted processes. | Apple documents helper/XPC capability separation. Ad-hoc signed helper ran: same-identity container reuse, unassigned host execution and broad network access violate the boundary. Dynamic scoped snapshots, XPC request authentication, Developer ID and notarization remain unverified. |
| Per-pod VM with broker-only host access | Guest owns writable pod files and copied snapshots. Host broker owns secrets/DB; all host tool/service requests cross an authenticated, assignment-checked interface. | Proposed fallback only. Guest image, architecture, SDK transport, startup/memory, network confinement and packaging remain untested. A VM does not automatically solve credentialed tool boundaries. |

Apple's current guidance says directly launched children inherit their parent's
App Sandbox and names XPC services, login items and helper apps as ways to split
capabilities. This supports investigating a helper; it does not certify our
specific policy. [Apple documentation](https://developer.apple.com/documentation/security/discovering-and-diagnosing-app-sandbox-violations).

Apple DTS described custom SBPL as undocumented for third-party use and explained
the deprecation of sandbox-exec. This is historical support guidance, not proof
that every possible modern native design is impossible.
[Apple DTS discussion](https://developer.apple.com/forums/thread/661939).

## Proposed bounded continuation and amendment

**Default:** retain the confirmed Electron/UI/SDK product decisions. Do not ship
the experimental policy as a security boundary. The basic supported-helper candidate has now failed three required boundaries.
Do not expand M0a into a sandbox framework; review the bounded VM amendment below
before further enforcement implementation.

Any alternative native candidate must demonstrate, with synthetic inputs in a minimal signed
bundle: two independent runner processes cannot read each other's granted files;
snapshot access remains read-only; the runner has no owner DB, credential or
shared secret-container access; no inherited descriptor or ambient grant escapes
the launch contract. It must also explain and test how host tools and destination
services are restricted without relying on a prompt or PATH. XPC identity and
request validation belong to the trusted broker.

Given the measured failures and the absence of a passing supported candidate,
the recommended amendment is **one additional engineering day, maximum,
for a VM transport feasibility experiment** before M1. Deliver a tiny signed
host launcher with one disposable guest, one synthetic SDK stdio bridge, one
broker request and the same file/network denial matrix. Accept only if the guest
cannot reach host files/services directly, only assigned requests cross the
broker, and process cleanup is observable. Record measured cold start, memory,
disk size and supported CPU/OS constraints rather than inventing thresholds.

This amendment would move pod execution into a guest while preserving the macOS
desktop UI. It adds a guest image, transport adapter and image-update/recovery
work; re-estimate M4, M6 and M12 after the experiment. It requires owner review
before that extra work. No VM, helper entitlement or product change has been
silently approved or implemented here.

## Remaining acceptance matrix

| Required evidence | Status |
| --- | --- |
| Development script/native/shell/grandchild path denials above | PASS, limited to measured cases |
| Safe launcher drops inherited handles | PASS in this synthetic launcher; product integration UNVERIFIED |
| Basic signed App Sandbox helper | FAIL: shared container, host execution and unassigned service access |
| Alternative XPC design, scoped grants, Developer ID/notarization | UNVERIFIED; ad-hoc verification does not cover release |
| Actual Codex file/command tools under the same boundary | UNVERIFIED; no model calls |
| Interpreter bypass through unassigned script/module contents | UNVERIFIED; copied-native denial is insufficient |
| Detached descendant cancellation, revocation and cleanup | UNVERIFIED |
| Broader networking, metadata and runtime read-surface policy | UNVERIFIED |
| M0b: ape-shell, grant checks and tool-only credentials | UNVERIFIED, not started |
| M0c: atomic snapshot capture, next-run changes and integrity | UNVERIFIED; static fixtures here do not prove capture semantics |
| M0d: o365 OAuth/Graph fixtures and refresh | UNVERIFIED, not started |
| M0e: packaged Codex/SDK/app-server startup and streaming | UNVERIFIED, not started |

## Verification and handoff

Fresh full repository `pnpm lint --force`: 50/50 tasks, zero cached.
Fresh full repository `pnpm typecheck --force`: 71/71 tasks, zero cached.
The explicit experiment lint, typecheck, TypeScript/native build and path-input
validation test passed. `test:boundaries` exits 1 and preserves the failure above.
This is a reviewable research result, **not a green product or merge gate**.
The original commit hook failure is archived in `evidence/commit-gate.txt`.
The audit prerequisite is now fixed in dependency commit
`21d80190811a1c10b59c0399fb64c8bd4576c6a0`, incorporated into this checkout and
published as [native PR 23](https://repos.openape.ai/patrick/monorepo/pulls/23).
Its full 48-task build and complete unit/E2E/layout CI passed, including the
pre-push gate. Server-side required checks govern merging that PR.

After integration, full forced lint/typecheck in the Pods checkout and explicit
probe lint/typecheck/build/path validation passed again. The original boundary
matrix reproduced 25 PASS / 1 FAIL. This experiment adds no product app or runtime
dependency; the prerequisite repair has its own commit, issue and report.

Logs: repository-local `.openape/check-results/pods-m0/full-lint.log`,
`full-typecheck.log`, `boundaries.log`, `boundaries.json`, `last-policy.sb`.
Run commands and fixture cleanup are documented in [README.md](README.md).
The dependency repair is isolated in issue 1347 and the audit-dependencies
worktree. This experiment can now proceed through its own commit/PR workflow. Review the
VM amendment before additional enforcement work; M0b–M0e remain pending. Keep
M1 blocked and live access unapproved.
