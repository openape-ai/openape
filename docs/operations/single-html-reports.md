# Single-HTML Reports and Plans consolidation — issue 1429

Approved [plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M486HDNVQDQED9S45AJTJNF3)
and [native issue](https://repos.openape.ai/patrick/monorepo/issues/1429).
The October 6 production cutover is recorded below; final retirement acceptance is in progress.
The [creator guide](../../packages/ape-testruns/README.md) and generated CLI help ship
with the publishing package. No existing producer schedule, credentials or delivery
state is changed by this migration. No test notification may be sent.

## Rendering and data boundary

Schema 2 accepts one finished UTF-8 HTML document, up to 20 MiB, with embedded
resources up to 8 MiB each. Categories/tags/namespaced text metadata have no business
semantics. Exact bytes, metadata and legacy source form immutable versions. A stable
`/d/ID` URL resolves latest; `?v=N` selects an immutable version. Current audience and
retention apply to all versions. Schema 1, uploads, static sanitization, original slugs,
series binding and daily briefing receipts remain compatible.

The trusted shell displays metadata and an explicit active-content choice. HTML runs
in an opaque `sandbox=allow-scripts` frame on `report-content.openape.ai`. A short-lived
256-bit capability binds identity, document, edition, access/retention revisions and
viewer origin. Every delivery rechecks current authorization and expiry. Direct browser
navigation is denied using Fetch Metadata; content-origin application/auth routes are
404. Capabilities disappear on process restart. Responses are no-store and no-referrer.
No cookies or app credentials are forwarded into the document. Only external HTTPS
images are allowed as declarative external resources; the service never fetches them.

M1 disproved an absolute network-egress guarantee via WebRTC. The owner explicitly
retained active HTML under publisher responsibility. Browser CSP is defense in depth,
not a promise that document data cannot leave. Do not remove the visible trust notice.
External images are provider-dependent, and exported files are outside hosted headers.

## Controls and recovery

- `NUXT_HTML_PUBLISHING_ENABLED`: schema-2 creation and metadata/content updates;
  default false. Disable independently of existing static publishers.
- `NUXT_HTML_WRITES_FROZEN`: schema-2 mutations, including policies and removal.
- `NUXT_HTML_CONTENT_ORIGIN` and `NUXT_PUBLIC_HTML_CONTENT_ORIGIN`: same separate
  HTTPS content origin. Do not use the application origin.
- `NUXT_PLANS_CONSOLIDATED`: enable the Reports legacy Plans API.
- `NUXT_PLANS_WRITES_FROZEN`: freeze compatibility writes in Reports.
- Plans: `NUXT_REPORTS_WRITES_FROZEN` freezes old API mutations even before routing
  changes; `NUXT_REPORTS_ORIGIN` then routes to Reports without opening the old DB.
- Both apps share a new `NUXT_PLANS_BRIDGE_SECRET` / `NUXT_REPORTS_BRIDGE_SECRET`
  of at least 32 characters. The forwarding shim returns 503 when its destination is missing; it has no fallback database or writer. Preserve the existing Plans invite signing secret as
  Reports `NUXT_PLANS_INVITE_SECRET`, so existing invitations remain valid.

Bridge assertions last 30 seconds and bind the verified subject/actor, exact method,
path/query and request digest; replay is rejected. Old-host authentication verifies
its original audience first. User cookies and bearer tokens never cross services.
Clients must submit the version they read. Missing `expected_version` returns 428
with an upgrade instruction; stale versions return 409. Status remains metadata.

Expiry/removal denies content immediately, without the minute cleanup loop. Thirty
24-hour days later cleanup erases all online HTML/source/version metadata and replaces
receipts with minimal tombstones. Restore is owner-only, requires a new explicit
lifetime and resets audience to private. Restoring never renews previous grants.

The synchronous policy journal defaults to `<database>.policies.json`, or use
`NUXT_HTML_POLICY_JOURNAL_PATH`. It contains current policies, minimal receipt identities
and team/publisher permissions, never document HTML/source. Persist it on durable storage and
preserve the **current** copy separately when restoring a DB backup. Do not replace it
with an older backup. Startup applies newer revocations, expiry, team removal and purge
before serving; a populated DB without its journal, an instance mismatch, or a backup
missing newer immutable versions fails closed. Recover the latest DB/content in that
case; never reset the journal to make startup pass. A failed journal write returns 503
and may follow a committed DB write: reconcile the original receipt, never change its key.

Existing host backups retain the last 14 objects, not a guaranteed number of days.
They may contain historical content until rotated; online purge is not a claim of
instant backup erasure. Take consistent SQLite snapshots for migration. A restored
backup cannot be exposed until the current policy journal and immutable content reconcile.

## Single-writer cutover

Run only from clean, merged canonical main after exact-head native review/CI and
`pnpm check:ci`. The Reports build includes `.output/server/plans-migration.mjs` in
the tested image; use that same image for migration, with protected mounted files.
The operator accepts explicit `file:/absolute/path` DBs and writes snapshots with
exclusive creation and mode 0600. Snapshot contents are private and must not be evidence
uploads. Command help: `node /app/.output/server/plans-migration.mjs --help`.

1. Verify npm publication and upgrade `ape-plans` before mandatory version enforcement.
   Preserve installed producer commands and auth caches. Deploy both reviewed images
   through `pnpm deploy:image testrun plans --dry-run`, then the tested-image workflow.
   Leave interactive publishing off, legacy routing unchanged and Plans writes frozen
   while taking the final snapshot. Verify reads still work and both API write paths
   reject writes. Keep unrelated Reports producers running.
2. Preserve protected consistent copies of the old Plans DB, Reports DB, current
   policy journal and routing/env configuration. Record SHA-256 and SQLite quick_check.
   The source census was 154 Plans, two teams, two memberships and zero invitations;
   use the actual frozen final snapshot as the authority, not those historical counts.
3. Stop the Reports process briefly while operating on its SQLite DB; an offline operator and a running cleanup worker must never write the journal concurrently. Existing producer state/receipts remain intact.
   `snapshot --database file:/legacy.db --output /protected/plans.json`.
   `import --database file:/reports.db --input /protected/plans.json --writers-frozen`.
   `reconcile --database file:/reports.db --input /protected/plans.json`.
   Repeat import: imported zero and the same source digest. Reconciliation must have no
   unexplained differences in IDs, source/rendered bytes, metadata, attribution or roles.
   Already-deleted orphan team references remain deleted, without recreated membership.
4. Provision the content-domain A record through configured Exoscale DNS. Add only its
   HTTPS router to the existing Traefik file provider and existing wildcard TLS setup.
   Route to the Reports service; disable router access logs/tracing, including any HTTP
   redirect router, so capability paths are not retained. The deployed Traefik supports
   [per-router observability controls](https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/observability/).
   Verify TLS, denied direct navigation and application/auth routes before enabling HTML.
5. Configure both bridge ends, existing invite secret and Reports consolidated mode;
   set old Plans `reportsOrigin` while writes remain frozen. Verify old reads, team and
   invitation behavior, protected source, human redirects and token-audience denial.
   The old application must no longer open/write its DB. Switch one authoritative writer
   to Reports; unfreeze its compatibility writes and the forwarding shim only after checks.
6. Enable new HTML publication. Test synthetic private/team/reader/public reports, all
   version denials, content/API isolation, old shared links/uploads and the installed CLI.
   Keep recovery/purge time travel on isolated copies. Record actual production evidence
   and personally inspect visible results. Remove the retired legacy writer code after
   acceptance; retain only the authenticated route/API/UI compatibility surface and backup.

## Rollback

Before routing changes, disable new HTML and keep the unchanged legacy source authoritative.
After any Reports source edits, first freeze both entry points. Never restore a stale DB:
`rollback-export --database file:/reports.db --output /protected/delta.json --writers-frozen`,
then `rollback-apply --database file:/legacy.db --input /protected/delta.json
--expected-digest FROZEN_SOURCE_DIGEST --writers-frozen`. Reconcile exact source, status,
attribution, roles and deleted rows before switching routing back. The reverse mapping
rejects a stale legacy writer and refuses active source-less, non-team or finite-lifetime
Plans that the old service cannot represent. Keep writes frozen and fix forward in that
case; never widen rights to make rollback fit. Purged content is omitted and stays gone.

Disable interactive publication/viewer routing independently of readable schema-1 reports.
Keep the current DB/journal and all newer versions. Removing the content router denies
new frame delivery without rerouting private HTML through a legacy shared endpoint.
Restore only the recorded DNS/router/env changes; do not restore producer checkpoints,
credentials or notification state.

## Verification and producer decisions

Retained feature contracts cover authorization across versions, CAS/idempotency, denial,
expiry/private restore/purge, journal recovery and migration/reverse reconciliation.
The existing Reports unit/layout/E2E and CLI suites remain the test infrastructure;
no browser CI or new runner was introduced. Build Reports first: the recovery-readiness cases launch the actual built server. Run local E2E with `pnpm --filter @openape-testrun/app exec vitest run --config vitest.e2e.config.ts --no-file-parallelism`: concurrent Nuxt dev instances otherwise compete for generated configuration in the same checkout. The private shared contract workspace is
bundled into the CLI and both apps, so the workspace graph selects all consumers.

All existing producers retain their previously verified compatibility decisions in the
[previous delivery record](generic-reports-migration.md). The current inventory and
receipt will be updated after rollout: schema-1 PR reports and briefing sender stay
compatible; existing Test Runs upload/exporters stay compatible; upstream mail/calendar
and direct-message producers remain unaffected. New direct HTML publication and optional
local templates are additive. A no-send fixture is distinct from the first regular
producer publication; observe the latter without manually triggering it.

## Producer compatibility, October 6

Read-only supported Pods inventory was refreshed during issue 1429. No producer
script, resource assignment, credential, schedule, checkpoint or pending effect
was changed. Natural checkpoint progression is distinct from migration changes.

| Producer | Verified current source | Decision | State preserved |
| --- | --- | --- | --- |
| IURIO PR monitor | `158083853caa5f07eec600317cc194afd2a058a99eac123d3a0fb6307e9b6df8`, local schema-1 HTML renderer | Compatible PR Updates adapter | Active; 900-second schedule revision 2; resource epoch 43; dedicated publisher and receipt-before-send flow |
| Morning sender | `ce3ac5cbfc2b8e0f910dd036a8a4a23b62d42833797c0e25cac19c443e4c1009`, briefing/v1 | Compatible Briefings adapter | Active in enabled daily 07:00 workflow revision 7; standalone schedule remains disabled, resource epoch 34 |
| Linde server report | `be3ba0bcbfb31c55b1a085a2187c8863b867dba9233f12bdc697159136365373`, local schema-1 HTML/CSS renderer | Compatible Test Runs adapter | Paused, separate workflow disabled; resource epoch 9; pending delivery state preserved |
| Morning editorial/mail/calendar sources | Existing pinned workflow hashes | Unaffected upstream sources | No publication endpoint or schedule change |
| Direct-message monitors and mail networks | Supported current workspace inventory | Unaffected | No report-contract dependency or manual trigger |
| Existing CLI/Test Run/E2E/guide/iOS exporters | Existing manifest and asset ingestion | Compatible Test Runs adapter | Original URLs, uploads, authentication and series behavior retained |
| New direct creator | `ape-reports`, one complete HTML file | New generic publication | Private/permanent defaults; local templates optional; no companion asset upload |

The earlier migration record is historical: Mail-Kurzbericht is now archived,
IURIO Task monitor and zaz are active without blocked inputs, and the Delta Mind
mail network is active at revision 3. This task did not make those changes.
First regular post-rollout publication is recorded separately after observing it;
a successful no-send acceptance fixture is not that observation.

## Production cutover receipt, October 6

Native implementation PR 259 merged as `6fbec604`, release PR 262 as `5965c083`,
and CLI version-display PR 263 as `cf61e9fc`. Registry Reports 0.4.0 and Plans 1.0.6
are installed and verified with the existing shared login. Both production services
run tested `prod-5ecd9033`, after full clean-main `check:ci` and external CI5455.
The unrelated intervening Troop merge is preserved without deploying Troop.

All 154 frozen Plans reconcile exactly, with zero additions on repeat import.
Frozen source digest: `04125f08b2a54763ef04b03555783ca4ab10e86f67240c4c340394791b5f0168`.
Consistent DB/journal/config backups are protected on Chatty under
`/home/openape/migrations/reports-1429-20261006`. Never restore the frozen policy
journal over its current counterpart. Reports is the sole writer, both freezes
are off, and HTML publication is enabled. Content DNS and router removal/restoration
were tested before activation; TLS, direct-navigation denial and application-route
isolation pass. No producer configuration, credential or delivery state changed.

[Private production Test Runs](https://report.openape.ai/d/01M48K08CJ2SYKSDBFV947ETA6)
contains actual installed CLI/production receipts, real-clock expiry/restoration,
15 denial checks and personally inspected authenticated screenshots. The first
narrow screenshots expose a metadata overlap; the correction and retired writer
removal require the follow-up deployment. This receipt does not claim final acceptance.
