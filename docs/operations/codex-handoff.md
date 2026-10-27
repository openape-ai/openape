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
its task and plan approvals to immutable job inputs before dispatch; that workflow
integration is **not implemented by M1**. An approval for a mutable file path alone
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

This is an M1 candidate in the existing `@openape/apes` package. The local Pod test
uses a self-contained bundle of this exact command implementation, outside Git;
it is not a package release or a replacement of the installed owner app.
Personal scripts, real inputs, model receipts and run evidence stay outside Git.
M2–M4 approval, Azure verification, notifications and seven-stage wiring remain
separate plan milestones. No automatic merge, deployment or signing is included.

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
all tool calls on repeat. This tests the mechanism, not human approval of an INITECH
task. The final PR receipt records the required affected gate and source SHA.
M2–M4 product-task/plan approvals, Azure workflow and seven-Pod acceptance are not
certified. POSIX uid/socket checks fail closed elsewhere. Full-access Codex jobs
share the owner's trust boundary; local receipts do not contain a malicious
owner agent or turn a worktree into filesystem isolation.
