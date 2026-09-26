# Workflow graphs and mail pilot

Workflows compose existing Pods in the sidebar alongside groups. Adding or
removing a Pod reference never changes its script, permissions, checkpoint,
lifecycle, group or independent schedule. Existing profiles receive schema 20
without any automatically created workflow or enabled schedule.

## Execution contract

A workflow contains 1–32 distinct Pods and directed dependencies. Every incoming
edge is required: a node starts only after all its predecessors completed
successfully in the same run. Roots and independent branches may run concurrently
within the existing global limit. Cycles, duplicate nodes, foreign predecessors,
archived Pods and stale edits are rejected at the worker boundary.

Manual runs are one-shot runs, including for paused workflows and paused member
Pods. They do not activate a schedule. Workflow pause prevents further node
starts; already running nodes finish. Resume releases the pause. An individually
paused Pod is still callable by the workflow, just as with its manual Run action.

Schedules support interval, daily local time, one-time local date/time and
five-field cron with an explicit timezone. Cron uses OR when both day-of-month
and weekday are restricted. Preview and execution use the same evaluator.
Missed slots coalesce into one run. Slots arriving during an active run coalesce
into that run, without another queued catch-up run. One-time slots are consumed
once. The app must be running; no background OS service is installed.

Cron follows Croner 10: a missing 02:30 spring-transition time in Europe/Vienna
runs at 03:30; the repeated 02:30 autumn time runs only once. The existing daily
schedule contract instead advances a missing local time to the first valid
minute (03:00). The displayed next occurrences expose this difference.

One database transaction reserves the complete Pod set, preventing partial-lock
deadlocks, workflow overlap and standalone/terminal bypass. Contending workflows
wait in start order. Standalone and workflow scheduler priority alternates after
actual dispatches. External effects and unresolved accepted input keep their
existing fences. Changing pinned scripts, resource epochs or assignments blocks
continuation and requires a newly reviewed run.

Failures block descendants. Independent branches can finish. Retry inspects the
failed attempt and reruns only that node; successful nodes and published outputs
remain intact. Startup reconciles execution domains before the scheduler starts.
Interrupted nodes require explicit inspection/retry. Cancellation stops active
processes first; use Finish cancellation after they stop. Uncertain effects must
be reconciled before reservations can be released.

Remove workflow is available after the active run is settled. It hides the
workflow and removes current membership while retaining immutable run/effect
evidence. Pods referenced by retained history cannot be physically deleted.
Restore disables schedules, pauses unfinished workflows and invalidates restored
authority. Restored mail scopes are permanently blocked from dispatch: reconcile
old receipts, settle the old run, then create a new workflow with a quiet
baseline. This deliberately excludes the historical backlog. A backup is not
proof of external state after its capture time.

Completion-only nodes require no script edits. Optional result handoff uses
`await context.workflow.publish({ schema: 'example/v1', data: {...} })` and
`context.input.workflow.outputs`, keyed by predecessor Pod ID. Results are
immutable, explicitly published, versioned JSON objects capped at 64 KiB.
Checkpoints are never implicitly handed to successors.

## Mail integration

Use `examples/mail-workflow-filter.mjs` and
`examples/mail-workflow-important.mjs` as separately reviewed scripts. Graph
membership alone cannot constrain an arbitrary existing script's mailbox reads.
The old Mail-Kurzbericht script and its schedule are not migrated automatically.

The workflow owns the exact mailbox, assigned application ID, two Pod IDs,
Telegram credential alias/destination, archive rules and protected partners.
Each rule requires an exact sender, List-ID and subject prefix. New rules are
disabled. Protected addresses and explicitly listed domains override every
archive rule; subdomains are not inferred. Senders, recipients, reply addresses
and observed conversation participants are considered. Personal or uncertain
mail, attachments, flags, high importance and recognized financial, legal,
security, deadline and action content stay in the Inbox. These conservative
checks are not a proof of semantic completeness; review any proposed rule.
Mail content is data, never executable policy or tool instructions.

The first run records a quiet historical baseline, without moves or Telegram.
Messages received during baseline enumeration are queued for the next batch.
Delta pagination resumes durably. A batch freezes at most 100 pending messages
only after enumeration reaches its provider boundary. New arrivals wait for a
later batch. A backlog over 5,000 pending items blocks for review; no item is
silently dropped. Script invocations process bounded pages and may require
explicit continuation after reaching their per-invocation limit.

Before moving, the transport re-reads identity, version and folder. Owner-moved
or removed messages are excluded; changed versions are queued for fresh
filtering. Archive receipts retain before/after IDs, resulting folder/version
and request ID. Every confirmed move is individually listed in the persisted
Telegram report with sender, subject, reason and receipt. A failed/uncertain
move stops further moves and blocks the successor. Reports distinguish failure
and uncertainty from confirmed archival.

The important-mail recipe sees only retained content from the sealed batch.
It summarizes in German with no agent tools and uses the durable outbox.
Notifications mark IDs processed only after confirmed delivery. Uncertain
Telegram outcomes require owner evidence; retries never assume Telegram
supports client idempotency. Confirmed receipts repair local progress without
resending. Explicitly confirmed non-delivery permits a new outbox attempt;
confirming a move did not happen keeps that item in the Inbox.

The production adapter requires the companion CLI's `pods-mail/v1` contract,
explicitly assigned through normal program permissions. The bundled historical
read-only CLI is unchanged. No binaries, grants or live profiles are installed
by this change.

**Production autonomous archiving remains unavailable.** Microsoft Graph's
published move contract does not establish atomic conditional-version semantics.
The production adapter therefore sets `conditionalMoveVerified=false` and
refuses moves. Controlled tests can exercise confirmed/failed/unknown moves;
they do not establish that missing provider guarantee. A future provider-backed
solution or separately reviewed human-confirmed operation is needed before live
archiving can be enabled. Schedule/owner approval alone cannot bypass this gate.

## Concrete disabled pilot

- Name: `Inbox filtering → Important mail`.
- Mailbox: `phofmann@delta-mind.at`; same-mailbox Inbox → Archive only.
- Nodes: a new reviewed filter recipe → a new batch-aware important-mail recipe.
  Keep the existing Mail-Kurzbericht Pod unchanged during preparation.
- Mode: `preview`; workflow paused; schedule `null`, enabled `false`.
- Rules: none enabled. Candidate shape: exact owner-selected newsletter sender,
  List-ID and subject prefix, subject to every protection above.
- Protected partners: required owner-reviewed addresses/domains; no guessed
  contacts. Until supplied, the pilot has zero enabled archive rules.
- Telegram: existing destination ending `5587`, credential alias
  `telegram_bot_token`; review the full locally saved destination before setup.
- Application: select the separately reviewed `pods-mail/v1` CLI resource;
  no fallback to ambient/default accounts. Resolve and review actual folder IDs
  during separately authorized read-only setup.
- First run: quiet baseline; no historical processing. A future cutover must
  review legacy notification markers or explicitly choose a quiet rebaseline.
- The retired Delta Mind Troop/OpenClaw duty stays paused; its archive grant
  stays revoked. Existing independent schedules remain unchanged.

Implementation acceptance is separate from installation, live read-only preview,
mail mutation authority, real Telegram delivery and schedule activation. Each
live step needs explicit owner authorization. Synthetic evidence demonstrates
local ordering and recovery, not a live mailbox result.

## Morning review with human-confirmed archive grants

The `mail-triage.mjs` and `morning-mail-briefing.mjs` examples compose a read-only
review predecessor and the existing calendar/issues briefing. Both workflow nodes
use result handoff. The review publishes `morning-mail-review/v1`; the briefing
requires that day's result and displays its explicit coverage and gaps. The
companion reads read and unread Inbox messages, including bounded conversation
context. The example reviews at most 500 messages per mailbox and reports any
unreviewed remainder. Protected and uncertain messages stay in the Inbox.

Assign `examples/microsoft-mail.mjs` as `pods-mail` with its Shapes adapter and a
native Node runtime using `--use-env-proxy`. Supply `O365_CACHE_DIR` through the
reviewed runtime descriptor and assign read access only to a dedicated Microsoft
cache directory. The companion reads the selected account's existing MSAL cache;
renewed tokens stay in its private, encrypted program HOME. Do not assign an
owner home or expose credentials through script variables. Network destinations
are only graph.microsoft.com and login.microsoftonline.com. Grant mailbox-bound
list/read/thread operations, never a standing archive permission.

`context.mail.archive.prepare({application, mailbox, items:[{id,version,reason}]})`
re-reads up to 30 proposed messages, freezes current provider metadata and creates
a 12-hour once grant. Batches fit the existing broker limit of 4,096 characters per summary and argument; excess candidates remain in the Inbox and are explicitly reported by the briefing. Its summary lists every sender, subject, date, mailbox,
source URL and reason. The exact manifest is bound into the authorized command;
the requester-provided summary remains display information under the existing
Grants protocol. Readable metadata is checked against the frozen manifest by the
executor. The grant URL is returned immediately without waiting for approval.

An independent polling schedule on the review Pod calls
`context.mail.archive.process()`. Only a manual decision by that Pod's owner is
accepted: automatic, standing, reusable, substituted or expired grants cannot
move mail. The signed token is verified and the once grant consumed before
execution. The pinned application and each message's immutable identity, version
and Inbox location are rechecked. Each outcome is durably recorded outside the
script workspace in `mail-archive/<podId>/`. An interrupted operation or uncertain
move is never retried automatically; inspect the grant and actual mailbox
receipts before owner reconciliation. Preserve this directory with the profile.

This explicit human-confirmed path does not enable the autonomous mail pilot.
Microsoft Graph does not document an atomic conditional move: the companion
rechecks immediately before a folder-scoped move and validates the returned
immutable ID and destination. A concurrent change between GET and POST remains
a provider limitation, disclosed on the grant. No atomic version guarantee is
claimed. Neither preview nor triage moves mail. Manual example runs preview;
only scheduled polling can act on a separately approved concrete mail batch.
