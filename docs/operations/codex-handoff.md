# Durable Codex handoff (M1 candidate)

`apes codex dispatch --job /absolute/job.json --receipts /absolute/private/receipts`
starts one immutable job on an **already running** official Codex app-server daemon.
`status` and `reconcile` inspect the same job; both can recover a lost turn response.
Both may persist a recovered turn identity; this is their only write. They never
create another thread or turn. No daemon is installed, started or restarted.

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

## Verification status

The real Pod dispatched once and returned before Astra's delayed marker write.
Effective settings and actual shell exit codes were recorded. A separate direct
host harness discarded an actual turn/start response after daemon acceptance;
it stayed unknown on repeat and later reconciled the original completed turn.
This harness is not a real Pod replay. A real unchanged Pod repeat after completion
remains blocked by runtime capacity, and full M1 acceptance is not certified.
The candidate bundle used for live acceptance precedes the final filesystem/exit
status refinements. The final source has 16 passing focused tests and a passing affected unit gate at
`cd5c80c814738ec4ffd560867748e31fca3e5bda`. This documentation correction changes no
implementation; the pre-push hook also checks its final commit. M2–M4 are not certified.
The Unix socket and uid checks target POSIX hosts; other hosts fail closed.
