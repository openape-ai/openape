# Central Pods workspace

Issue: https://repos.openape.ai/patrick/monorepo/issues/1378.
The central workspace is an opt-in owner pilot. Patrick approved service deployment,
installation, restart and live adoption on September 24, 2026. Finish active runs
and back up the app and profile together before replacing the executor. Preserve
the IURIO monitor baseline, schedule and delivery receipts.

## Authority and execution

The workspace service stores owner-scoped snapshots, immutable artifacts,
commands and their receipts in a dedicated SQLite database. The verified owner
is the exact DDISA issuer/subject pair. Browser and desktop share the same Vue
workspace and committed data. Connected Codex and native permission changes
enter the same command stream; secret values and native paths stay in their
local closure, with only a generic completion receipt sent to the service.

The current desktop is the only executor. Its existing SQLite database becomes
a local execution and recovery projection. A server command is claimed once;
the desktop executes the existing validated domain command and publishes the
result and snapshot in one server transaction. A successful UI response follows
that transaction. Background run progress also produces committed snapshots.
Domain revision, script validation, permission and resource-epoch checks still
apply. Progress publication does not discard an already accepted command.

Runtime sessions are fenced by an unpredictable lease and the registered device
generation. Heartbeats run during long commands. Availability expires after 30
seconds; new automatic starts require a local lease no longer than 25 seconds.
An active run can reach its local safe boundary after connectivity is lost.
Its progress is reconciled before new work. An execution whose outcome was not
journaled is **unknown**, never automatically replayed. Pausing schedules is
separate from availability: a paused, connected Pod remains editable.

## Publication format and connection status

Issue: https://repos.openape.ai/patrick/monorepo/issues/1384.
Format 2 splits the snapshot into content-addressed parts: `workspace`, `artifacts`,
`schema`, one part per Pod, per script version, per run record and per run's events,
and archive tables in chunks of 16 rows (`contracts/central-parts.ts`). The desktop
uploads only parts the service does not hold (`parts`, batches of at most 2 MiB),
journals the manifest delta in `publication.json` and commits it with `publish`
(`format: 2`). The service verifies every part hash and the manifest digest, validates
changed parts and cross-part bindings, and commits atomically. A refused delta (409)
is rebuilt from the current state. The first format-2 publication uploads about
20 MB once; afterwards a scheduled run changes a few parts (tens of KB). The worker
reports a change counter, so an idle desktop builds no snapshot at all.

Compatibility: the service still accepts full format-1 snapshots from older desktops
and keeps their `snapshot` column for rollback. A desktop that sees no `format` on
`begin` publishes full snapshots. Parts live in additive tables; `user_version`
stays 1, so an older service can open the database again.

Heartbeats run every 10 seconds on their own and never wait for a publication; the
service accepts the current or the just-replaced hash. Request timeouts are 15 s
plus 1 s per 32 KiB. `CentralController.status()` reports `state`
(connecting, online, reconnecting, offline), `error` prefixed with the failing phase
(for example `worker snapshot: …`), `since`, the scheduling `gateUntil`, the worker's
last scheduler tick and the last publication size. The desktop shows it as a banner;
MCP `runtime` returns it as `central`, and the desktop's own `workspace inventory`
entry carries it as `desktop`. MCP commands fail with `Central workspace offline:
<reason>`. After five minutes offline the desktop sends one macOS notification and
another when scheduling resumes. The service inventory adds `lastSeenAt` per runtime
and `queue` (blocked inputs, since, error) per Pod; archived Pods keep their
lifecycle while offline and appear in a separate sidebar section.

Reads: `read` with `view=summary` returns the Pod with its latest 20 run records
and no events; `view=runs` pages older runs, `view=run` returns one run with its
events and `view=version` one script version. Without `view`, `read` returns the
complete legacy Pod. The desktop refreshes on the runtime `changes` long poll and
falls back to a 5 s timer against an older service.

Changing a Pod's application while one of its runs is in progress is refused;
previously it cancelled the run and blocked the schedule queue.

Each awaited scheduler tick step (storage inspection, reference scan, master stop) is
bounded; an expired step is logged and reported as `tickTimeout {phase, at}` in the
status, and scheduling continues. When runs stop while the desktop is online, check
`desktop.tickingSince`, `tickPhase` and `tickTimeout` in MCP `workspace inventory` first.

Rollout order: deploy the relay and install the desktop back to back. A relay
deployment makes an older desktop republish its full snapshot, which its fixed 15 s
timeout cannot finish on a slow uplink (observed September 25, 13:33–14:00).

## Stored data and local exclusions

The explicit `centralTables` allowlist in `src/contracts/central.ts` covers:

| Domain | Central data |
| --- | --- |
| Pods and identity | Stable Pod IDs, names, assignments, public identity references and current owner/runtime binding |
| Organization | Groups, membership and organization revision |
| Scripts | Drafts, versions, validation receipts, package manifests and dependency locks |
| Work | Schedules, accepted events, run inputs/history/events, checkpoints, recovery reviews and effect receipts |
| Knowledge | Sources, claims, mail extraction/context and workflow state/history |
| Administration | Description, ordinary variables, resource metadata and existing conversation/control history |
| Managed artifacts | Referenced script/source blobs and regular files under each Pod's managed workspace |

Credential stores, private keys, access/refresh tokens, native login files,
execution-domain records, process leases, remote device tokens, local HOME,
native dependency installation directories and separately granted folders are not imported. Public key IDs and
credential aliases are metadata, not credential values. Ordinary source data
and user-created workspace files are intentionally online; secret-valued files
must remain in the existing credential facilities.

The native helper opens every source component without following links and
rejects hard links for managed capture. Files are immutable by SHA-256 in the
service; an owner may download only a file in that Pod's committed manifest,
and only while the Pod is online. Individual files and complete JSON snapshots
are bounded to 32 MiB; inventory is bounded to 100 Pods and 100,000 files.
Unchanged files reuse a validated inode/time fingerprint to avoid repeated
native capture. Runtime/security state is never reconstructed from this archive.

## Browser and service configuration

The web entry is `/workspace`. It uses the existing DDISA SP implementation with
an independent HttpOnly workspace cookie. Mutations require the configured
Origin; APIs return no-store responses. Only direct human sessions are accepted.
Pilot membership is checked on every authenticated request. Provider endpoints
such as `/authorize`, `/token` and identity enrollment retain their routing.
The proxy additions route `/workspace`, `/workspace-auth/`, `/api/workspace/v1/`
and `/pods-assets/` to the workspace service.

Configure through the approved secrets and deployment process:

- `NUXT_WORKSPACE_ENABLED=true` and `NUXT_RELAY_ENABLED=true`.
- `NUXT_WORKSPACE_DATABASE=/data/workspace.sqlite`, separate from relay.sqlite.
- Distinct random `NUXT_WORKSPACE_SESSION_SECRET` and
  `NUXT_OPENAPE_SP_SESSION_SECRET`, each at least 32 characters. Defaults fail closed.
- Existing `NUXT_RELAY_ORIGIN`, enrollment policy and owner allowlist.
- The SP client ID must match the host; production uses `pods.openape.ai`.

Keep both databases and their SQLite WAL files on durable storage. Use SQLite's
online backup mechanism or a stopped service for consistent copies. Do not copy
a live database without its WAL. Central snapshots and artifact BLOBs are in the
same workspace database. The existing agent IdP remains a separate service.

## Disposable adoption rehearsal

1. Build the service and desktop candidate from the feature branch. Use an
   explicitly isolated fixture profile and synthetic accounts; never point a
   second process at the installed owner's profile.
2. Start the candidate with `OPENAPE_PODS_CENTRAL_ENABLED=1`. The worker initially
   blocks automatic starts. Connect the owner accounts in Desktop settings and
   register this desktop through the existing signed DDISA device enrollment.
3. Registration reuses existing identities and provisions missing identities through
   the verified owner’s existing provider connection. All imported Pods must bind
   to that exact owner; conflicting identities fail closed. Never rewrite ownership
   records to bypass this check.
4. The runtime publishes its allowlisted domain data and managed artifacts,
   stores a durable adoption receipt, and only then enables its execution lease.
   Existing Pod IDs, identity references and schedule revisions are preserved. Once
   the profile has its `central/` directory, ordinary application launches keep
   central authority even without the launch environment flag. Disabling or removing
   that directory is not a supported rollback.
5. Verify the shared inventory, edit a description, run a synthetic script from
   both clients, compare checkpoint progression and receipts, and restart the
   same fixture. The established unit and native suites automate this rehearsal.

Creating a Pod from the central UI provisions its existing Pod identity through
the desktop. Native program/credential/folder setup remains available in the
shared desktop Permissions and Values sections. Embedded chat is not restored.
Moving to another computer is outside this change.

## Recovery and rollout boundary

`central/state.json` records the last committed snapshot hash and revision.
`publication.json` is an idempotent publication journal; `completion.json` stores
an execution outcome before artifact upload; `executing.json` marks a claimed
command. Files are atomically replaced and flushed. Reconnection retries the
same publication, never the executed command. An old adoption receipt that
disagrees with the server is refused.

For an unknown operation, preserve the local profile and central database,
inspect the actual run/effect ledger, and reconcile the observed outcome before
allowing further work. There is deliberately no blind retry or destructive
"reset sync" button. Do not remove the journals to force adoption. Production
support for operator-assisted recovery and retention remains a rollout concern;
central mode disables local restore/deletion/cleanup to prevent competing state.

The approved live cutover uses a maintenance window: finish current runs, take paired
backups, verify the candidate and its exact-source checks, stop the old executor,
and enable central authority on the same profile. Keep the existing IURIO
baseline, checkpoint and notification receipts. Rollback must preserve newer
central writes and reconcile them; restoring an older full profile can repeat
external effects. Disabling a browser route alone does not transfer write
authority back to an old desktop.
