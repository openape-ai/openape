# Autonomous Pods: frozen M0 design

Implements [plan revision 2](https://report.openape.ai/d/01M4R7G9398CQ3QADNFVM7YKWT?v=2),
[issue 1465](https://repos.openape.ai/patrick/monorepo/issues/1465). This page freezes the
schema, the script API, the migration mapping and the removal ledger that M0 requires. It
records implementation details the plan left open; it does not change the plan's scope.

## Baseline (October 12, 2026, 16:43 CEST)

- Canonical main `7fab4b84`; installed desktop and relay `prod-7fab4b84`, schema 47.
- 41 Pods: 18 active, 23 archived. Two active networks: Mail (`b95f1f8a`, revision 3,
  11 members, Intake every 900 s, routes `uncertain-review` (choose) and
  `newsletter-approval` (approve)) and Morgenbriefing (`48bdf52b`, revision 1, four
  members `6a33e686`, `4a8e089e`, `a8c9ee9c`, `8690fe6a`; the source runs daily at 07:00
  Europe/Vienna). Three standalone Pods: PR monitor, Task monitor, Service-Agent.
- Live legacy state: 1,317 events and deliveries (1,305 done, 3 discarded, 9 briefing done),
  2,358 invocations (59 historical `blocked`, none running or unknown), 136 decided choices
  and none open, 63 gate tasks (none pending), 114 archive effect attempts (108 applied,
  6 not applied, none open). The network data and artifact tables are empty.
- Approved Mail grants: Intake reads (`mail.list`, `workflow.read`), Archive preview
  `workflow.read` and `workflow.move` (always). No network member except the archive Pod
  holds a `pod-runtime` grant; the four Morgenbriefing Pods do.

## Storage

One SQLite database (`control.sqlite`, schema 48) stays authoritative. Schema 48 has no
network table. New tables:

| Table | Purpose |
| --- | --- |
| `data_namespaces` | Hierarchical public namespace: one `writer` (Pod ID or `owner`), `mode` `records` or `results`, optional payload schema, `writer_epoch` fence |
| `data_readers` | Explicitly authorized reader Pods per namespace |
| `data_entries`, `data_entry_revisions` | Current value and bounded history per key; `sequence` is a global change counter for discovery cursors; result entries carry operation, rule version and input binding |
| `work_operations` | Selected contract per operation: input and output namespace, relevant fields, equality filter, selected rule version, reprocess generation, discovery cursor |
| `work_items` | Semantic work key, state, attempt, lease generation, claim token, run, retry time, reason |
| `owner_questions` | Durable owner questions bound to object and input fingerprint; answers become `owner`-written entries |
| `action_approvals`, `approval_batches` | Object/action approvals decided at the IdP (replaces approve routes) |
| `effect_attempts`, `effect_receipts` | External action identity, intent, provider receipt, confirmed or unknown outcome (generalized network effect ledger) |
| `storage_receipts` | Conversion, backup and restore receipts |
| `legacy_records` | Generic inert history: every row of every retired network table as JSON |
| `local_only_pods` | Former network members: published as placeholders, refused for browser commands |

Renamed: `network_owners` → `owners`. `network_scheduler_state` is retired with the other
network tables.
Dropped columns: `pod_grants.network_id/network_revision`, `pod_sandbox(_deny).network_revision`.

Namespace paths are lowercase segments (`[a-z0-9][a-z0-9._@+-]*`, at most 8 segments,
200 characters). Owner, company and account scope are the leading segments, for example
`delta-mind/mail/messages`. A key is `namespace/record`; the longest registered namespace
prefix owns it. Listing matches whole segments only, so `mail/class` never reads
`mail/classifications`.

## Script API

```js
await context.data.get('delta-mind/mail/messages/AAMk…')       // null or { key, revision, value, author, updatedAt, result? }
await context.data.set(key, value, { expectedRevision: 0 })     // writer only; never in a results namespace
await context.data.delete(key, { expectedRevision })
await context.data.list('delta-mind/mail/messages', { cursor, limit })
await context.work.find({ operation, limit })                   // ready work, oldest first, bounded
await context.work.claim({ key, expectedInputFingerprint })     // one winner; returns claimToken and the input entry
await context.work.complete({ claimToken, result })             // result entry + completion marker, one transaction
await context.work.defer({ claimToken, reason, until })         // waiting for a prerequisite; no model call
await context.work.fail({ claimToken, reason, retryable })
await context.decisions.ask({ namespace, key, fingerprint, title, body, options, data })  // asking again refreshes a waiting question
await context.decisions.withdraw({ namespace, key })              // the object no longer needs the owner
await context.approvals.request({ action: 'mail.archive', object, payload })  // title derived from the payload
await context.approvals.get(id)
await context.mail.archiveApproved({ application, mailbox, approval })  // the authorized mail effect service
```

A script declares the operations it serves:

```js
export const work = [{ operation: 'delta-mind/mail-classification', input: 'delta-mind/mail/messages',
  output: 'delta-mind/mail/classifications', fields: ['contentRevision'], filter: { direction: 'received' }, ruleVersions: [1] }]
```

It names no producer, channel, next Pod or edge. The selected rule version and the
reprocess generation are explicit owner commands; activating a script never reprocesses
objects by itself.

Work key: `sha256([operation, object, inputFingerprint, ruleVersion, generation])`. The
input fingerprint covers only the declared fields, so category, read-state or folder
changes do not invalidate content analysis. Work states: `ready`, `claimed`, `completed`,
`retry_wait`, `waiting`, `blocked`, `unknown`, `superseded`.

- Discovery scans input entries changed since the operation cursor (bounded pages) and
  inserts missing semantic keys as `ready`; resetting the cursor rechecks completion markers
  without creating duplicates. A changed input supersedes older open items.
- A claim holds while its run holds its run lease; `lease` increments per claim and fences
  late completions. Completion re-reads the input entry and rejects a stale fingerprint.
- A finished run releases its unfinished claims to `retry_wait` with bounded backoff, to
  `unknown` when the run left an unresolved external effect, or to `blocked` for owner
  review when the run completed an application write. An interrupted run keeps its claims
  until automatic recovery has proven its processes stopped. Restart never replays an
  unknown effect.
- The scheduler skips a scheduled run of a Pod that declares work when nothing is ready,
  due or awaiting approval; sources without `work` run on their schedule.

## Approvals and effects

`context.approvals.request` records one item per stable action object and payload hash.
Items of one Pod collect into one open IdP batch (two-minute quiet window, at most 100
grants, seven days), using the existing grant authority and audience `pods-graph-gate`.
Polling happens inside the Pod's own runs. `context.mail.archiveApproved` verifies the approval at
the IdP, re-reads the message, compares the approved version, sender and subject, moves it
once and records intent and receipt in `effect_attempts`; an unknown outcome holds that mail.
Denied, expired and superseded approvals stay final.

## Storage readiness and recovery

The worker opens the database after it has answered `ready` for the shell: it reports
`storage: starting | ready | recovery` with a classified reason (`busy`, `disk-full`,
`permission`, `io`, `schema-newer`, `schema-older`, `conversion-blocked`, `invalid-data`,
`corrupt`, `missing`, `timeout`). No schedule, claim or effect starts before `ready`. A
missing database in a profile that has existing content (marker `storage.json` or
non-empty `pods`, `blobs`, `remote`) is a recovery case, never a fresh start. Diagnosis
never writes to the failed database; recovery preserves `control.sqlite`, `-wal`, `-shm`
and `-journal` as a set before any repair. Restore always uses a validated candidate
profile and an atomic profile switch; automation stays paused until the owner confirms the
external actions since the snapshot are reconciled.

Automatic verified backups: every six hours when idle (recovery-point objective six hours),
into `<profile base>/Backups`, four retained generations; the last verified backup is never
removed after a failed backup. Measured startup bound: storage readiness or a recovery view
within 30 seconds on the reference Mac.

## Mail: eleven members, seven responsibilities

| Responsibility (retained Pod) | Operation / role | Writes |
| --- | --- | --- |
| Mail Sync (`34e55caf`, Intake) | Source: Inbox and Sent delta, coverage; category writer | `mail/messages`, `mail/coverage`, `mail/category-overrides`, `mail/category-state` |
| Mail Classification (`b8d80bc2`, Triage) | `mail-classification` from messages; `mail-owner-classification` from owner answers | `mail/classifications` |
| Mail Overview (`8cd7c48d`, Review) | `mail-overview` from relevant classifications | `mail/summaries` |
| Invoice Review (`17a7fb7f`) | `invoice-review` from invoice classifications | `mail/invoice-reviews` |
| Reply Preparation (`7a96d135`) | `reply-preparation` from reply-needed classifications | `mail/reply-proposals` |
| Newsletter Review (`129579b8`, Archive preview) | `newsletter-review` from newsletter classifications; IdP approval; approved archive move | `mail/newsletter-reviews` |
| Knowledge Suggestions (`ba66f28f`, Memory) | `knowledge-suggestions` from messages (received and sent) | `mail/knowledge` |

Owner answers: `mail/owner-answers` (writer `owner`). Learned sender policy:
`mail/sender-policy` (writer `owner`), imported once from the 136 decided legacy choices
with their decision IDs as evidence. Retired: Sent mail (`4e8f7343`), List filter
(`8d378a66`), Categorisation (`40b40648`), Newsletter batch (`6a610611`); archived with
history, no executable binding.

Categories `Rechnung`, `Newsletter`, `Antwort nötig`, `Prüfen`, `Behalten`: Mail Sync is
the single category writer; it merges with the latest provider set, keeps unrelated
categories, records each intent and verified result, and treats an unexplained change as
an owner override (`mail/category-overrides`). A removed managed category is suppressed;
`Behalten` blocks archive candidacy.

## Morgenbriefing

| Pod | Writes / operation |
| --- | --- |
| Mail-Prüfung (`6a33e686`) | Daily 07:00 source: `briefing/mail-review/<date>` |
| Kalender und Issues (`4a8e089e`) | `briefing-sources` → `briefing/sources/<date>` |
| Redaktion (`a8c9ee9c`) | `briefing-edition` → `briefing/editions/<date>` |
| Calendar-Bot (`8690fe6a`) | `briefing-publication` → `briefing/publications/<date>`; publication and notification keyed per series and Vienna date |

The installed policy is kept: missing calendar sources stop the edition (retry), missing
issues are an explicit gap, editions older than two hours are not published, and a day is
delivered once (`lastDeliveredDate` carried from the network checkpoint into the Pod's
private checkpoint).

## Conversion 47 → 48

Refuses before mutation when any invocation is running, stopping, interrupted or unknown,
any delivery is pending, claimed, retrying, blocked or unknown, a choice is undecided, a gate
task is open or uncertain, an effect attempt is intent or unknown, a join is pending, or
network data/artifacts or staging rows exist, or a network package import is in progress.
Running `codex-network` MCP actions are marked interrupted. Otherwise it copies every legacy row to
`legacy_records`, maps effect attempts/receipts and member checkpoints, verifies counts and
SHA-256 per table, drops the network tables and writes a `conversion` receipt. Network tags become the
members' own tags (within the tag limit), network denylists are merged into the members'
own denylists (more than 32 entries blocks the conversion), and every former member is
recorded in `local_only_pods`. Schema 46
upgrades through 47; schema 45 and older are refused.

## Implementation notes (M1–M5)

Recorded during implementation; none changes the plan's scope.

- Files: `data_artifacts` and the `artifacts` field of results were dropped before
  release. Large files stay in assigned folders and records name their path and digest;
  no Pod needed managed artifacts.
- Owner administration of shared data is one MCP action, `domain` (list, define,
  setReaders, assignWriter, entries, set, delete, work, reprocess, release, answer,
  resolveApproval, resolveEffect). Writes are journaled under their `requestId`.
- Rollout deviates from R1/R2: the relay and the desktop are switched in one window while
  the desktop is quit, because the relay contract changes together with the retired
  network reads.
- Review follow-ups (October 12): approval exchanges run after the run authority exists and
  finish before the script starts; owner recovery settles the claims of an inspected run;
  `selectRule` selects a changed work contract or rule version; a result is discarded when
  the input, rule version or generation changed during the run; an answer slot belongs to the
  Pod that asked; an emptied database file in a used profile counts as missing; blockers are
  checked before the pre-upgrade copy, a failed conversion removes its redundant copy, and
  automatic backup rotation only counts generations of the same profile.
- Known limits, accepted for this release: an approval that was used up at the IdP while the
  move was then refused (the message changed) is final, and the result says the message was not
  archived; a result skipped by discovery while its upstream input was momentarily different is
  not rediscovered if that input later returns to the exact earlier content; a storage failure
  after startup ends the worker and shows recovery after quitting and reopening Pods; schema-47
  backups with open network work cannot be restored by this version (use the paired rollback
  profile of the previous release).
- The owner MCP session may answer owner questions and decide object approvals, as decided on
  October 10, 2026 for grants; the phone inbox may decide questions, held work and uncertain
  actions of local-only Pods, which it reaches only as the signed-in owner.

