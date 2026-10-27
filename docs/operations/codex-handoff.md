# Durable Codex handoff and exact approval receipts

`apes codex dispatch --job /absolute/job.json --receipts /absolute/private/receipts`
starts one immutable job on an **already running** official Codex app-server daemon.
`status` and `reconcile` inspect the same job; both can recover a lost turn response.
Both may persist a recovered turn identity; this is their only write. They never
create another thread or turn. No daemon is installed, started or restarted.

`apes codex digest --job FILE` returns the canonical digest without connecting or
writing. Use it to construct exact approval argv instead of duplicating normalization.

The manifest schema is `openape.codex-job/1`: `key`, absolute existing `cwd`, explicit
`model`, `sandbox` (`read-only` or `danger-full-access`), `approvalPolicy: never`,
`prompt`, and integer `maxAgeSeconds` (60–604800). Unknown fields are rejected.
Canonical identity uses a fixed-order JSON object, canonical realpath for cwd,
exact prompt bytes and SHA-256. Same key with changed inputs is a conflict.

Create the receipt root explicitly with mode 0700 before using the CLI. The root
and job directories must be real directories owned by the current user; symlinks
and group/world permissions are refused. Retain this local, owner-controlled root. Removing or editing receipts defeats deduplication. Separate receipt
roots are separate dispatch authorities; do not assign two roots to the same job.
Prompts and effective execution settings are private records. Nothing in this
adapter grants permission to perform the requested effects. The caller must bind
its task and plan approvals to immutable job inputs before dispatch; M3 adds the exact-start workflow described below. An approval for a mutable file path alone
is insufficient for production work.

An exclusive hard-link publication elects one dispatcher. File and directory fsync
complete before any start request. Concurrent callers see `dispatching` during a
bounded settling window. Thread/start's actual model, cwd, sandbox and approval
policy must match before turn/start. Server-initiated client requests are refused;
unattended work must not require interactive input. The socket defaults beneath
CODEX_HOME; `--socket` selects another existing Unix socket.

`inProgress`, `completed`, `failed` and `interrupted` are daemon turn states.
`completed` is **not** verification of test results, expected files or a PR.
Those belong to the consuming stage. Old in-progress turns become `stale` and
require investigation; no restart recovery promise is made.

After uncertain thread/start, retain `unknown` and inspect the daemon manually.
After uncertain turn/start, exact digest-tagged user input and one unique matching
turn permit reconciliation. Missing or ambiguous observations never permit retry.
Transport/schema/configuration/persistence failures do not mean human rejection.
CLI exit codes: 0 = inProgress/completed; 3 = dispatching/not-started;
2 = unknown/blocked/stale/failed/interrupted; 1 = local/usage error; inspect status before any action, never blindly retry. Read the JSON state; exit 0 alone is not job completion.
Thread reads are bounded to 32 MiB. Transport, oversized payload and schema failures
return unknown with phase thread/read; they never permit a new start.

## Delivery boundary

This is an unreleased candidate in the existing `@openape/apes` package.
The standalone `ape-codex` entry point exposes the same commands as `apes codex`. The local Pod test
uses a self-contained bundle of this exact command implementation, outside Git;
it is not a package release or a replacement of the installed owner app.
Personal scripts, real inputs, model receipts and run evidence stay outside Git.
The personal seven-stage wiring is activated locally; fresh product planning
through both approval gates remains a separate acceptance boundary. No automatic merge, deployment or signing is included.

## Result inspection and input pinning

`dispatch`, `status` and `reconcile` accept `--expected-digest`, the SHA-256 of
`JSON.stringify(normalizeJob(input))`. A mismatch exits 2 with `blocked/digest`
before connecting or writing an intent. The normalized in-memory job is reused.
This binds content; it does not supply task or plan authorization.

`status --result` and `reconcile --result` return the identified completed turn's
single `agentMessage` with `phase: final_answer`, its item ID and SHA-256 over the
exact UTF-8 text. A full item view is required. Missing, ambiguous, malformed,
partial or larger-than-256-KiB final output is `unknown`, never truncated success.
Commentary and unfinished output are not completion results. Consumers validate
business schemas and independently inspect tests, Opus receipts and provider
metadata; model text alone is not proof of these effects.

## Exact approval receipts (M3 candidate)

`approve --job FILE --receipts APPROVAL_ROOT --expected-digest SHA256
--reference STABLE_REFERENCE --expires-at UTC_TIMESTAMP` records one immutable
`openape.codex-approval/1` receipt. It never connects to Codex or dispatches work.
The command must itself run through the existing exact-operation IdP approval;
put the digest, stable reference and expiry in the actual argv, not only a summary.
Repeats recover the original receipt without rewriting it, including after expiry
(`expired`, exit 2). New expired approvals publish nothing. Recorded approvals exit
0; digest mismatch exits 2; usage, conflict and new-expired errors exit 1. Conflicting references
or expiry values do not replace authority. A consumed grant with no receipt is
unknown and requires explicit recovery; never invent a new reference automatically.

`dispatch --approval-root APPROVAL_ROOT` requires a matching unexpired receipt
before socket access and again after connection, before a new intent. Existing
intents remain observable after expiry without renewed authority or another start.
The intent retains its approval reference and expiry. Expiry immediately before
thread/start leaves a blocked intent; it cannot silently retry. Task, base commit, plan digest, intended branch and permitted effects must
be included in the immutable job prompt. Approval of planning does not authorize
an implementation job with different content. A new digest must really return
pending in the actual IdP flow; a reusable broad grant is not a human decision.

These are owner-controlled local workflow records, not signed IdP assertions.
The approval Pod is deterministic; downstream Pods receive read-only assignments.
All jobs share owner trust: explicit full access can technically alter other files.
The CLI does not claim containment against a malicious owner agent. Material input
changes are a workflow invalidation: downstream scripts compare current task/plan
inputs and withdraw obsolete pending references before considering new work.

## Verification status

Final M1 source has real Pod normal and unchanged-repeat acceptance. Normal run
`cdf1a206-b533-4de0-899b-759f921378cc` returned in 2.798 seconds, before Astra wrote
the isolated marker. Repeat `56d40c35-1142-4e16-9acd-b087b0c6c9a4` returned the same
thread/turn with `skipped: true`. Effective configuration matched the authorized
model, cwd, full access and never policy. The exact candidate bundle digest and
write-after-exit timestamps are retained in the private Test Run.

A final-source host harness discarded an actual accepted turn/start response.
The immediate repeat stayed unknown; later reconciliation recovered the original
completed turn without starting another. This is a disclosed host fault harness,
not a live runtime restart test. PR 516 resolved the previous runtime blocker and
was separately merged, deployed and installed with owner authorization.

The original M1 implementation has 16 focused tests and passing affected gates.
Result extraction, exact-digest pinning and approval receipt recovery bring the
focused total to 36 checks. Final-answer retrieval matched the actual daemon
message and UTF-8 digest. A real referenced approval fixture stayed pending under
the same grant, recorded once after an authorized fixture decision, and skipped
all tool calls on repeat. This tests the mechanism, not human approval of an IURIO
task. The final PR receipt records the required affected gate and source SHA.
IURIO #7054 subsequently completed the authorized Pod-started implementation,
Azure draft PR 903, independent Azure verification and one queued notification;
unchanged repeats created no additional effects. Its planning stage adopted an
existing approved plan, so this is not evidence of fresh product plan generation. POSIX uid/socket checks fail closed elsewhere. Full-access Codex jobs
share the owner's trust boundary; local receipts do not contain a malicious
owner agent or turn a worktree into filesystem isolation.


## Exact-start approvals and reusable observation (M3/M4)

The personal task-approval and plan-approval Pods now request the actual immutable
`dispatch` operation. The exact argv contains the job digest, one stable reference,
receipt root and `--deadline`. Approval starts that one job asynchronously. The
planning and implementation consumers only use `lookup`; they have no reusable
business dispatch grant. The older receipt command remains available for existing
jobs, but local receipt contents are not a substitute for a new human decision.

A new dispatch refuses an expired deadline before admission and again immediately
before thread/start. Its immutable intent retains `startApproval.reference` and
`startApproval.deadline`. Existing intents remain observable after expiry. A
pre-start expiry leaves a terminal failure; it does not create a new identity.
`requestStart` persists the job and exact request before calling the runtime,
reconciles a lost response against that bound intent, and retains pending/unknown
outcomes. A consumed reference without an observed intent requires investigation.
It never invents a new reference to get past denial, expiry or uncertainty.

`ape-codex lookup --jobs JOBS --receipts RECEIPTS --query QUERY` observes only an
existing job. QUERY contains `{id, file, digest}`: a 64-character hex workflow ID,
`job.json` (or legacy `job-v2.json`), and the canonical job digest. Queue roots are
absolute, private owner directories; linked job paths and changed digests fail
closed. The result is the original turn's complete final answer. These fixed argv
can receive a reusable read grant while job identities change inside the queue.

`advance` may also dispatch automatic infrastructure inspections. It additionally
requires `--policy ABSOLUTE_FILE --policy-digest SHA256`. The owner-approved policy
pins cwd, model, sandbox, approval mode, age, key template, manifest filename and
prompt prefix; only trailing JSON evidence varies. Changing policy bytes or fixed
execution settings requires a new exact grant. Product planning/implementation
consumers do not receive this permission. A full-access inspection prompt is an
instruction, not an OS-enforced read-only boundary or prompt-injection containment.

`@openape/apes/pods` provides reusable file publication, exact-start requests,
observation, failure classification and supersession. Personal domain scripts stay
outside Git. Obsolete pending references are withdrawn from their immutable request;
already started jobs remain observable even after selection changes. Unknown
transport/parse errors retain their cause and do not become human rejection.
Explicit terminal job failures are retained and notified once per stage/status.

The selector excludes rejected task content across unrelated base changes and
completed task content still present on the board. Blocked inspection is distinct
from rejection and excludes only that exact task/base revision; a changed input
can be reconsidered. Content rejection survives unrelated base advances. The implementation consumer independently reads the active Azure
PR inventory and checks repository, source/target branch, commit, active and draft
status; an inventory at its 1,000-entry bound fails closed. Notification receipts
mean queued, not read. Existing jobs/receipts are preserved through the migration.

Executable hashes are checked by the native runtime. Shared Pod helper code is in
an owner-controlled read-only directory assignment; its bytes are not individually
included in every IdP grant. This remains one owner's trust boundary. No daemon
restart, malicious-owner containment, merge or deployment guarantee is made.
