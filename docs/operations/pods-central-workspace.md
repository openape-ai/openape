# Central Pods workspace

Issue: https://repos.openape.ai/patrick/monorepo/issues/1378.
The central workspace is an opt-in candidate. Do not enable it on an existing
owner profile while its installed app is running. This change does not install,
restart or migrate the owner's Mac app or alter the IURIO monitor.

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
3. All imported Pods must already bind to that exact owner. Mixed-owner or
   unbound profiles fail closed; do not rewrite ownership to bypass this check.
4. The runtime publishes its allowlisted domain data and managed artifacts,
   stores a durable adoption receipt, and only then enables its execution lease.
   Existing Pod IDs, identity references and schedule revisions are preserved.
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

A live cutover needs a later maintenance window: finish current runs, take paired
backups, verify the candidate and its exact-source checks, stop the old executor,
and enable central authority on the same profile. Keep the existing IURIO
baseline, checkpoint and notification receipts. Rollback must preserve newer
central writes and reconcile them; restoring an older full profile can repeat
external effects. Disabling a browser route alone does not transfer write
authority back to an old desktop.
