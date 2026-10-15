# Pods execution migration — issue 1497

Approved proposal: [revision 2](https://report.openape.ai/d/01M4ZXED8YT88G56VGCG9C9JR7?v=2).
Base: `748782ce21e1079b39941284e4dd4156b8dba60d`. This record authorizes no production rollout.

## Execution boundary and caller disposition

`Pod → generic launcher → ape-shell → IdP → ape-shell → native supervisor/sandbox → target`.
`ape-shell -c -- PROGRAM ARGV...` preserves literal arguments. The private machine
variant is `ape-shell -c --request-fd 6`: one versioned request, authenticated
lifecycle, and an execution acknowledgement only after durable generic write
intent. Target stdout cannot manufacture a receipt. FD 6 is never inherited by
the target; FD 3 carries bounded runner input and service frames separately.

| Caller (under apps/openape-pods/src) | Boundary and verification |
| --- | --- |
| `main/broker/tools.ts`, `main/programs/invoke.ts` | Exact program/runtime argv and file pins through ape-shell; native broker/TLS, machine, assignment, cache and refusal cases |
| `main/programs/session.ts` | Same machine request with PTY; bounded output/lifetime, identity/lease revocation and process-group cleanup; native program and terminal cases |
| `main/shell/session.ts`, `runtime/program-client.ts` | Owner-configured wrappers forward actual target, prefix, argv, suffix and files; authenticated domain registration; native external-session/application success and refusal |
| `main/programs/launch.ts`, `runtime/shell-client.ts` | Fixed generated launcher opens ape-shell. Interactive shell authority remains explicit and cannot replace an exact program grant |
| `worker/runs/runner.ts` | Content-addressed script and pinned runner; input only on FD 3; execution budget begins at start, excluding authorization; native script/dispatcher/recovery cases |
| `worker/master/validation.ts` | Same runner; recheck draft, assignments and dependencies before acknowledging start; synthetic tools never fabricate provider observations |
| `worker/dependencies/install.ts` | Exact pinned npm-cli/package/lock through ape-shell; ignore-scripts, disabled bin links, bounded proxy, lock verification and active execution deadline; native preparation success/refusal |
| `worker/agent/executor.ts`, `worker/master/{host,transport}.ts` | Fixed reviewed Codex bootstrap. Strict app-server config and request allowlist; native shell/unifiedexec/apps/plugins/multiagent disabled. Requested programs use the assigned generic gateway |
| `main/connections/{process,auth-host,codex}.ts` | Fixed authentication app-server only; account/model discovery request allowlist cannot execute model tools |
| `main/connections/apes-login.ts` | Fixed whoami identity bootstrap, no Pod-supplied program or arguments |
| `main/ssh/invoke.ts` | Existing separately authorized fixed SSH service; no new local program bypass |
| `worker/runtime/{sandbox,terminal}.ts` | Native guardian/PTY primitives and inspection, not program authority. Production launchSandbox removed; direct sandbox probes live only in native fixtures |

The initial census found 22 process call/definition sites. Fixed native bootstrap
is not an arbitrary program surface. The structural cutover test rejects legacy
program authorizers and direct-launch fallback in program entry points. Owner
control-plane grant previews can ask the IdP for a decision, but cannot execute,
consume a token or make an execution receipt. Runtime/HTTP/SSH permissions retain
their separate existing contracts; none authorizes an ordinary program call.

Node inline code is exact argv; script files and preloads carry content hashes.
Supported Python and shell entry files are bound too; unsupported interpreter
modes/stdin fail closed. Configure the actual interpreter in assigned runtimes
(e.g. bash, not macOS sh's additional runtime dispatcher). Wrapper identities do
not replace the target. Rehash immediately before launch; this preserves the
existing pre-dispatch race protection, not a claim of atomic filesystem snapshots
or transitive module hashing. Children remain within the granted native sandbox;
there is no claim of syscall-level child authorization.

Ordinary assigned tools retain their managed read-only Pod identity where the
existing contract requires it, including Git credentials. Owner identity fallback
remains forbidden. Temporary parser isolation removes identity, network, normal
workspace and assigned directories and exposes only explicit pinned inputs.

## External mail behavior

Maintained tool: `https://git.openape.ai/delta-mind/o365-cli.git`, candidate branch
`feature/pods-protected-archive`, base `dfc306e30b50bbaab33c965007e8fd72894ce36a`.
Registry: `https://repos.openape.ai/patrick/shapes-registry.git`, branch
`feature/issue-1497-protected-mail`, base `958d342fcf263edae049d50907b99539cf33def5`.
Existing primary checkout changes are preserved.

The tool owns complete-message review, content-v2 identity, sender/subject/folder
checks, provider receipts and the shared mailbox journal. It fsyncs intent and
holds a cross-process mailbox lock before dispatch. Unknown outcomes hold the
message across Pods and content versions. Final provider preflight and move are
separate requests; the provider does not supply an atomic compare-and-move here.

The external automation package owns SQLite knowledge, immutable source blobs,
intake, conversation grouping, evidence-bound analysis and HTML/PDF/DOCX parsing.
It builds a standalone recipe bundle and separate pinned parser; neither is
bundled into Pods. Generic tools, model calls, progress and data publish results.
The parser has a 192 MiB heap, 15-second limit, bounded input/output and no network
or identity. Unsupported documents remain explicit gaps.

Registry `decision=once` requires an exact human single-use decision. Standing,
automatic, reusable and widened grants cannot cover it. `decision=deny` retires
raw mail move routes. Protected CLIs do not use unmatched-command fallback.
IdP/registry presentation owns mail labels. Changing a label or recipe does not
require a desktop rebuild. File claims and single_use constraints are additive
implementation contracts; compatible IdP/shared packages must precede cutover.

## Inventory and historical migration

Read-only inspection found installed Pods 0.1.3, Electron 40.9.3, darwin/arm64.
Its helper digest is `a4d1585bc1a683df35cd92407e1db0ce9ac5ccd44f8d46af2572674225bc4c7a`;
its lock digest is `bff254c7c74bd66268b01ddc933f82f7415d7f9664d4ac74fc0fcf0e9ad90619`.
Those artifacts do not prove an installed source SHA. Sixteen active scripts
were inspected: fourteen use generic APIs, one uses legacy archive approval and
one legacy program approval. Private caller snapshots and the PR-rebase draft
remain local under `.artifacts/pods-1497-migration`, outside Git/public reports.
The archive replacement is `examples/autonomous/newsletter-review.mjs`, delivered
as a separately reviewed script asset with an assigned shared journal.

Schema 53 retains schema-52 history, pauses every active Pod, invalidates previous
validation and prevents older apps reopening the profile. No installed profile
has been upgraded. Historical decisions remain visible without execution controls;
legacy grant approval is refused, revocation remains possible.

| Previous state | Treatment |
| --- | --- |
| collecting/requested/approved | Inert original evidence. New exact command request after migrated draft validation; no conversion of old authority |
| denied/expired/withdrawn | Preserve; no automatic request or execution |
| consumed/confirmed_applied | Permanent replay hold and original receipts |
| unknown/intent | Mailbox-wide hold until explicit receipt-bound reconciliation |
| confirmed_not_applied | Retain evidence; new operation still needs new exact authority |

Read-only rehearsal exported 107 decisions, 199 attempts and 402 receipts, then
imported 302 archive records into two temporary journals idempotently. A separate
knowledge import preserved seven namespaces, all 699 sources and all 707 claims.
The export manifest SHA-256 is
`febc88828b7d3d96dc6510e9a7c585dd45586cafd3b6779b276f2d89f1d85f37`.
Counts are snapshots of a running app, not a claim that live state stayed static.
Journal schema 3 retains original records and appends receipt-hash-bound explicit
reconciliation. Inspection/reconciliation never calls the provider or replays an
old operation. Old binaries reject schema 3. A fresh cutover export is required.

## Release and rollback gate

1. Build and review the exact IdP/shared-core, mail CLI, registry and recipe/parser
   artifacts. Record SHAs/digests together. Add the candidate CLI digest to registry
   tested digests only after real candidate option checks and synthetic behavior
   pass. The currently installed CLI digest is not candidate release evidence.
2. Release IdP and protected registry first. Verify the deployed adapter digest,
   raw-move denial, exact once behavior, no widening and file-binding support.
   An older registry is incompatible even if it can return an authorization JWT.
   Keep every affected Pod paused until that gate is verified. No auto-fallback.
3. Under separate rollout approval, quiesce the installed app, back up the whole
   profile, export fresh journals/knowledge and verify imports before upgrading.
   All mailbox recipes must share the same canonical private journal directory.
4. Install the matched desktop, apply reviewed drafts and immutable resource
   bindings, validate and activate individually. Do not revive all paused Pods
   automatically or treat old validation/decisions as consent. Do not move live
   mail or send a message merely to test the migration.
5. Observe naturally resumed work. On failure pause work and reconcile current
   execution receipts before rollback. Never overwrite newer consumed/unknown
   records with an earlier backup or let an old binary write the new schemas.

Implementation verification and production release are separate outcomes. Local
checks and Reports identify tested sources/artifacts; no installed app, scheduler,
provider mailbox, live grant or recipe was mutated by implementation work.

## Retired suite responsibility map

The following tests exercised implementations that no longer exist in the desktop. Their safety responsibilities move to `packages/apes/test/program-authorization.test.ts`, `apps/openape-pods/e2e/ape-shell-machine.test.ts`, the IdP grant tests, and external `internal/mail/archive_test.go`, `archive_history_test.go` and `automation/test/migration.test.ts`. `test/recovery/authority-cutover.test.ts` verifies retirement and historical preservation. Native credential/TLS tests remain in `e2e/broker.test.ts` and now use the generic ape-shell broker.

Retired implementation suite: `test/program-authorization.test.ts`

- 'sends the exact command and program hash and runs an approved call only with a verified token'
- 'asks the IdP exactly once per uncached call and reuses the token for identical commands'
- 'measures the local overhead of an uncached and a cached call'
- 'shows a pending request, waits for the owner and authorizes the call again after approval'
- it.each(['denied', 'revoked'] as const)('fails a %s call with today\'s wording and asks nothing else'
- 'keeps a call blocked when the owner denies its waiting request'
- 'refuses a brokered connection\'s token without its binding or decided by someone else, and accepts the matching one'
- 'refuses the reserved Pods permission names as program commands before asking the IdP'
- 'never lets a concurrent identical call execute on another call\'s single-use token'
- 'reuses a command token only for the same key and broker connection'
- 'consumes a single-use grant\'s token for exactly one call'
- 'treats a rate limit as transient and an IdP without the endpoint as an update requirement'
- 'names the HTTP status, problem and request id of a failed authorization, and refuses a too large command definitely'
- 'classifies a call by the IdP resolution in its token even when a mixed whole-program grant covers it'
- 'classifies writes and keeps mail moves in the archive port from the resolved actions'
- 'refuses every action of a mail program outside its archive port except known non-moving ones'
- 'authorizes the cache folder a program receives and re-checks the program file right before launch'
- 'refuses a changed program file and a tampered token before anything starts'

Retired implementation suite: `test/data/approvals.test.ts`

- 'requests once, binds each grant to the exact object and payload, and uses an approval exactly once'
- 'keeps a denial final, withdraws an approval when the content changes and asks an unanswered expiry again'
- 'never repeats an uncertain IdP request by itself and resumes only on the owner\'s decision'
- 'shows the message subject without a script title and binds the object to the message'
- 'lets the desktop act only on the stored requests of the calling Pod'
- 'moves an approved message once with an intent and receipt, and never twice'
- 'leaves a changed or different message in place'
- 'holds an uncertain move and never moves that message again, not even with a new approval'
- 'treats a crash after the intent as unknown at the next start'
- 'refuses to act on an approval that is not approved'
- 'derives the object from the exact command and shows the command line with the argv'
- 'passes the script\'s title, description and link to the IdP unchanged and keeps the approval bound to the command'
- 'shows the owner the complete command and refuses one that does not fit instead of shortening it'
- 'consumes an approved request and runs the exact command once, refusing a second use'
- 'refuses a different command, a foreign Pod and an undecided or denied approval before anything runs'
- 'lets the desktop run a command without a grant only for the consumed approval of its open effect'
- 'describes a command by its exact command line and refuses an application that is not assigned and declared'

Retired implementation suite: `test/mail/archive.test.ts`

- 'accepts archive prepare and process requests across the script frame boundary'
- 'reuses account-scoped read assignments for concrete messages and conversations'
- 'freezes provider metadata and binds one grant to each message'
- it.each(['pending', 'denied', 'expired'] as const)('does not move mail for a %s decision'
- 'consumes exactly once and never adds new mail to the approved batch'
- it.each(['changed', 'moved'] as const)('skips a %s message after approval'
- 'refuses changed identity between classification and grant preparation'
- 'retains an uncertain move across restart and never retries it'
- 'holds an archive batch interrupted mid-move and never moves it again'
- 'refuses changed program bindings and expired approved batches'
- 'validates proposal identities and resolves the companion archive operation exactly'
- 'keeps every message grant within the broker limits and leaves out only messages that cannot fit'
- 'moves only the approved messages of a partly approved proposal'
- 'expires a proposal approved under one collective grant without consuming it'
- 'supersedes pending grants when the reviewed application changes without consuming old authority'

Retired implementation suite: `test/mail/archive-authority.test.ts`

- 'accepts only the exact manually approved archive message'
- 'reads each member when the identity provider does not advertise batch listing'
- it.each(['auto_approval_kind', 'decided_by_standing_grant'])('refuses automatic grants marked by %s'
- 'rejects reusable grants and approvals by another owner'
- 'verifies a signed exact-message token and refuses a signed token for different mail'

Replacement acceptance passed: 1714 Pods unit tests, all 141 native cases in 30 files with a freshly packaged fixture, the affected repository gate including lint/typecheck/audit, 22 external automation tests, Go package/race tests, Windows cross-build and 32 registry adapters including actual candidate CLI options. These local checks do not replace the separately gated production rollout.
