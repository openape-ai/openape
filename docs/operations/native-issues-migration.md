# Native issues: M0 inventory and migration rehearsal

This is the first implementation increment of the [approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2A5ZAT63A04PWGVBT5M14MW), tracked in [issue 1356](https://git.openape.ai/openape-ai/openape/issues/1356).
It adds read-only inventory tooling and a disposable source-fence experiment.
Native issue endpoints, application UI and production imports are not implemented here.

## Scope and evidence identity

- Date: 2026-09-15. Canonical base: `08b1eaae3f9a129ee4b3c7563ba3803030bed43e`.
- Checkout: `openape-monorepo.worktrees/native-issues-m0`; branch: `feature/issue-1356-native-issues-m0`.
- Code and PR authority: `repos.openape.ai/patrick/monorepo`; native repository ID `01M141WFHN54H0MPB0SC002YD0`, owner `patrick@hofmann.eco`.
- Source issue authority: private Forgejo `openape-ai/openape`, repository ID `1`.
- Forgejo reports `15.0.5+gitea-1.22.0`. Read-only host inspection confirmed SQLite, `/var/lib/forgejo/data/forgejo.db`, native `forgejo.service` on the configured `chatty.delta-mind.at` host. No production configuration or database writes were performed. Only the implementation tracking issue was created.
- The planning base was `db8d87cdbf67f6ac497a84004edebddc2f624240`. Reinspection at the implementation base confirms that the issue/auth gaps in the plan persist. Pods is an additional app in the current product inventory.

The relevant native code remains [schema.ts](../../apps/openape-git/server/database/schema.ts), [repo-access.ts](../../apps/openape-git/server/utils/repo-access.ts), [require-auth.ts](../../modules/nuxt-auth-sp/src/runtime/server/utils/require-auth.ts), [repo discovery](../../apps/openape-git/server/api/repos/index.get.ts) and [ape-git.mjs](../../scripts/ape-git.mjs). M1 must address authorization before exposing issue storage or global discovery. DDISA reporting, participant access, API/CLI parity and PR linking retain the approved plan's contracts.

## Count-complete pilot inventory

The read-only API inventory ran from `2026-09-15T11:57:24.415Z` to `2026-09-15T11:57:40.698Z`.
The issue metadata snapshots before and after enumeration matched; per-issue comment totals reconciled.
Independent read-only SQL counts agree with the issue, text-comment and timeline totals.
This is an optimistic inventory, not a frozen final export: comment edits, assets and metadata require a new consistent snapshot during M6/M7.

| Concern | Observed | Migration treatment |
| --- | ---: | --- |
| Issues, excluding PRs | 230; 20 open | Preserve issue numbers and source provenance. |
| Maximum issue number / shared source number | 1356 / 1356 | Reserve the imported namespace before native creation; repeat at cutover. |
| Source PR records | 1126 | Exclude from issue import; retain as cross-reference targets. |
| Text comments | 175 | Preserve original comment IDs, actors, timestamps and order in the import map. |
| Timeline records, including text comments | 993 | Do not count all 993 as comments. Retain non-comment history as provenance/events under the plan. |
| Repository labels | 15 | Preserve source IDs, names, colors and descriptions. |
| Issue assets / comment assets | 3 / 0 | Three `.png` names on issue 1086, declared sizes 79,762 / 87,385 / 129,085 bytes. Actual bytes, hashes, MIME and protected downloads remain M6 gates. |
| Edit-history records | 37 | Preserve in the restricted archive; active edit-history UI is deferred. M6 must enumerate content versions and deletion markers. |
| Locked issues, multiple assignees, milestones | 0 each | Recheck at final export; do not assume future sources share these constraints. |
| Reactions, dependencies, tracked time, running timers, project membership | 0 each | Verified with read-only SQL; preserve/count or explicitly approve exceptions if later nonzero. |
| Pins, due dates, priority values | 0 each | Same exception policy. |

The metadata tool hashes titles/bodies and projects actor fields to source ID/login; it does not save bodies, emails or tokens. Restricted output belongs in the ignored `.openape/native-issues-m0/` directory, never in Git or a public report.

### Pagination behavior verified against Forgejo 15.0.5

`GET /repos/{owner}/{repo}/issues?state=all&type=issues&sort=oldest`, repository comments, labels and collaborators are paginated. Continue until the empty response even if the server caps the requested page size. Reject duplicate IDs and inconsistent advertised totals. The repository comments collection also contains PR comments; filter and reconcile against each issue's own count.

`GET /repos/{owner}/{repo}/issues/{index}/timeline` reports **the current page size** in `X-Total-Count`, unlike the ordinary collection total. Its terminal response can be `null` with count zero. The inventory handles this explicitly and retains page counts. The teams operation is an unpaginated array in the deployed OpenAPI; do not repeatedly request it with a page parameter.

The regex reference/image counts in the metadata inventory are discovery hints only. They are not a Markdown parser and cannot prove absence of reference-style images, HTML images, code examples or cross-host links. M6 must parse and classify complete source content without rewriting literal code.

## Source actors and permissions

Issue authors: source IDs `-1` (Ghost), `1` (patrick), `6` (werkstatt-qa), `12` (openape-operator). Comment authors additionally include `5` (werkstatt-backend).
The source collaborator list contains werkstatt-backend, werkstatt-qa, werkstatt-scribe, openape-operator and ape-git-mirror. The Owners team has owner permission and all repositories/units.

These are source identities, **not approved native principals**. A matching login is insufficient to grant native access or assignment. Ghost and historical automation authors retain original attribution; mapping each source actor to a verified DDISA principal is an explicit M6 prerequisite. In particular, the mirror service account must not gain issue rights merely because it can push Git.

The private source is not made public by its GitHub code mirror. M1 must enforce repository grants and participant access before SQL filtering/pagination, including counts and metadata choices. Tasks keeps task/reminder state; Plans keeps the approved proposal; the issue keeps discussion and resolution. Links between them do not copy status ownership.

## Product and repository mapping

Patrick approved D1–D6, including private-first routing and initial ownership. The following is the pilot configuration contract; no registry entries are created by M0. Patrick owns initial monorepo routes and unclassified intake. Agent/service names above are not product owners.

| Product key | Current source in this checkout | Proposed issue home |
| --- | --- | --- |
| `docs` | `apps/docs` | `patrick/monorepo` |
| `apes` | `apps/openape-ape-agent`, `apps/openape-nest`, shared agent packages | `patrick/monorepo` |
| `chat` | `apps/openape-chat`, `apps/openape-chat-cli` | `patrick/monorepo` |
| `crm` | `apps/openape-crm` | `patrick/monorepo` |
| `dashboard` | `apps/openape-dashboard` | `patrick/monorepo` |
| `idp` | `apps/openape-free-idp` | `patrick/monorepo` |
| `git` | `apps/openape-git` | `patrick/monorepo` |
| `monitor` | `apps/openape-monitor` | `patrick/monorepo` |
| `pods` | `apps/openape-pods` | `patrick/monorepo`; new app since planning baseline |
| `plans` | `apps/openape-plans` | `patrick/monorepo` |
| `pr` | `apps/openape-pr` | `patrick/monorepo` |
| `question-service` | `apps/openape-question-service` | `patrick/monorepo` |
| `secrets` | `apps/openape-secrets` | `patrick/monorepo` |
| `tasks` | `apps/openape-tasks` | `patrick/monorepo` |
| `testrun` | `apps/openape-testrun` | `patrick/monorepo` |
| `timetrack` | `apps/openape-timetrack` | `patrick/monorepo` |
| `troop` | `apps/openape-troop` | `patrick/monorepo` |
| Shared libraries/modules | `packages/*`, `modules/*`; [workspace map](../architecture/workspace-map.md) | `patrick/monorepo`; user-facing products above where identifiable, intake otherwise |
| `protocol` | Separate `protocol` checkout, local main `678a1e2`; native repo ID `01M1ZVK9E5XG67WPVJ8YCG4J3T` | Existing `patrick/protocol`, owned by Patrick; public activation still deferred |
| Unclassified reports | No current native intake repository | Proposed private `patrick/issue-intake`, owned by Patrick |

All 19 current `apps/*` workspaces are represented. Stable route keys may group CLI/desktop/server implementations. The added `pods` key follows the approved complete-ecosystem inventory requirement; its reporting action is delivered in M4.

The complete accessible Forgejo organization list contains 12 repositories. All-state, issue-only pagination found **zero issues** outside the monorepo: archived tasks, testrun, openape-pr, plans, timetrack; active website, protocol, sp-starter, chat-pwa-demo, agent-copy-test, ai-workflow-validation. Their empty trackers need no data import today. They are not automatically all enabled products.

Read-only local origin inventory also found independently hosted `.github`, agent-catalog, coding-agent, claude-plugin-openape-chat, escapes, agent-starter, idp-starter, preview, shapes-registry and website on GitHub; sp-starter points at Forgejo. These are configured origins, not proof of approved issue ownership. Preserve their Git hosting. Owner acceptance, complete GitHub issue inventory and issue-home-only registrations are separate ecosystem batches before claiming ecosystem-wide cutover. The native owner list also contains demonstrations/dotfiles: never classify every returned repository as an OpenApe product.

### Product entry point rollout

After the approved target routes and reporter access have been verified, enable `NUXT_PUBLIC_ISSUE_REPORTING_ENABLED=true` on the web apps. The shared SP module defaults it to false; Docs and the free IdP declare the same public setting. Links open the canonical reporting page in a separate tab with `noopener noreferrer` and `no-referrer`. They send only the fixed product key. Existing task/reminder and plan state remains unchanged.

Pods exposes **Help → Report a problem** only with `OPENAPE_PODS_ISSUE_REPORTING_ENABLED=1`. It opens the fixed `pods` URL from the main process without a new renderer capability. Agent/service/Nest `--help` and chat CLI help expose their `apes`/`chat` links with `OPENAPE_ISSUE_REPORTING_ENABLED=1`. The help path exits before starting the service. Keep all flags off until M7 routing acceptance; no application content, account identifiers or logs are attached automatically.

### Legacy consumers

Current [contribution guide](../how-to-contribute.md) and [autonomous workflow](../autonomous-workflow.md) query Forgejo's assigned-issue search. [AGENTS.md](../../AGENTS.md), [.openape/repository.json](../../.openape/repository.json), [active work](../agents/active-work.md) and operations documents link Forgejo issues. `apps/openape-chat-cli/package.json` still has a GitHub issue URL; `modules/nuxt-auth-idp/src/runtime/server/routes/authorize.get.ts` references historical GitHub issue 273.

Update active entry points only at M7; preserve historical links via the legacy map. Inventory linked Tasks, Plans, PR bodies and deployed worker/recipe configuration before cutover. Source-code searches do not establish complete coverage of those live consumers. Their inaccessible or uninspected stores remain explicit migration blockers, not implied zero counts.

## Reproduce the disposable fence proof

Use the [session toolchain](session-toolchain.md), activate `.nvmrc`, and run the [project Doctor](native-cli.md). Docker must be available. No dependency is added to the application.

```sh
node --test scripts/native-issues-inventory.test.mjs
# Obtain an authorized Forgejo token through the established credential channel.
# Supply FORGEJO_TOKEN in the environment, never as a literal command argument.
node scripts/native-issues/inventory.mjs https://git.openape.ai openape-ai/openape .openape/native-issues-m0/source-inventory-new

node scripts/native-issues/fixture.mjs up
node scripts/native-issues/fence-rehearsal.mjs
node scripts/native-issues/fixture.mjs down
```

`up` refuses existing named containers and existing credential files. Retain or rename a previous ignored fixture directory before a clean rerun. Partial setup failures leave only named disposable containers; inspect them, then run `down`. Cleanup verifies the `openape.task=issue-1356` label and never touches unrelated containers. Credentials remain in the restricted ignored fixture directory.

The fixture binds only `127.0.0.1:13856`, creates synthetic private `pilot/pilot` data, disables registration/mail/SSH and has no host mounts or Docker socket. Its runner uses the `m0:host` executor **inside the disposable runner container**, sharing only the fixture's network namespace. It runs a synthetic `test 1 = 1` job; it does not access production credentials or run the monorepo CI workload. Fixture lifetime is limited to one hour; clean it up after the proof.

Pinned official images:

- Forgejo `15.0.5`: `codeberg.org/forgejo/forgejo@sha256:eda2e378442d2f18cfa563994f8ad66e71f04ac9c3bb4259cc57bdd641890f5c`.
- Runner, observed `13.1.0`: `data.forgejo.org/forgejo/runner@sha256:c4af85fd9f0dd03788676a534781a87c71aa2c6a37737143e017eb94d4312952`.
- Sources: [Forgejo Docker installation](https://forgejo.org/docs/v15.0/admin/installation/docker/), [official Actions runner image](https://forgejo.org/docs/v15.0/admin/actions/installation/docker/), [versioned push processing](https://codeberg.org/forgejo/forgejo/src/tag/v15.0.5/services/repository/push.go).

The prototype installs SQLite triggers for source issue rows and related comments, assignments, labels, edit history, projects, reactions, timers, dependencies and attachment metadata. It compares OLD and NEW ownership on updates. The triggers are removed in `finally` and are never applied to production. The script only accepts the fixed local fixture; there is no production endpoint argument.

Observed final rehearsal (after a successful clean setup):

| Behavior | Result |
| --- | --- |
| Create issue/comment, edit issue/comment, close issue, create label | HTTP 500; database rejects writes |
| Read private issue with fixture token | HTTP 200, state open |
| Push branch and main with `closes #1` | Both refs point to `a91ff73c5c43149d62486d7b4fa95ef578b087b6` |
| Publish and read commit status | HTTP 201, combined state success |
| Actual Actions run on main | Run 4, same commit, status success while fence installed |
| Issue/comment fingerprint before/after Actions completion | Identical SHA-256 `de12161b272173462abf7bd939b3076107eabd5071c48c9862f9322ea5104f21` |
| Remove triggers and add comment | HTTP 201; disposable rollback restores writes |

### Interpretation and remaining production gates

This demonstrates feasibility, not a production-ready freeze. HTTP 500 is an unattractive but verified denial; M6 must provide a deliberate maintenance response/banner. A source write fence must stay installed for the retained archive, including background queues. An early prototype removed it immediately after the push response and a queued auto-close then changed the issue; waiting for the actual Actions run exposed and eliminated that false proof. Forgejo logs `updateIssuesCommit` failure but continues push notifications. A successful synthetic Actions job proves this path only, not every production mirror/CI path or queue-drain condition.

M6 must test every UI/API mutation, attachments and their blob deletion ordering, actor/label deletion and administrative operations, imports, hooks, issue transfers, PR operations and organization labels. SQLite triggers alone do not freeze attachment bytes, an external index, all parent records or every plugin. Repository-wide labels may also affect PR label maintenance. Keep Git pushes, pull refs, webhooks and established CI pipelines under explicit acceptance. Never archive the whole repository as a shortcut.

Old URLs retain their authorized Forgejo page and original `#issuecomment-<source-id>` DOM target in the MVP archive approach. A private fixture opened anonymously returns 404; after normal fixture login, `#issuecomment-1` scrolls to and highlights its original comment. The clean spike was visually inspected. The logged-out login return dropped the fragment: the user had to reopen the original link after login. M6 must fix or explicitly handle this continuation before claiming seamless old-comment navigation. M6 still needs the migrated destination, a source-page notice, and end-to-end authorized source→destination navigation; HTTP does not send fragments to the server. Any redirect variant must preserve the fragment with a destination alias or client-side mapping and be separately tested. No production redirect was configured.

Do not authorize cutover until owner/identity exceptions, attachment integrity, live-consumer coverage, complete freeze coverage, final export reconciliation, source links and native ACLs are proven. Before destination writes begin, rollback discards the staged import and removes the source fence. After destination writes begin, disable writes at both ends, reconcile new native writes under an approved recovery procedure and then choose one authority. Never restore an old database over new writes or enable permanent bidirectional synchronization.

## Verification and next step

[Published M0 evidence](https://testrun.openape.ai/r/qb1qRzK_O4lxWkvlblxDHYra) contains the synthetic screenshot and observed outputs. A self-contained HTML copy is retained in the ignored local review-report directory.

Eight behavioral inventory tests cover capped pagination, duplicate IDs, totals, terminal null responses, denied pages, metadata minimization and separating PR comments. The disposable setup and fence were rerun from an empty fixture with the pinned images. Full repository gates and the native PR source are recorded in [active work](../agents/active-work.md).

M0's pilot inventory and feasibility proof are reviewable. Unresolved actor mappings, actual attachment downloads and independent repository owners are retained migration gates. Finish native PR review and required checks before integrating this increment; M1 then adds repository authorization and issue storage without changing production issue authority.

## One-way import operator (M6)

The implementation is `scripts/issue-migration.mjs`. Run `--help` for the actual
contract. There is no background job, generic API impersonation field or reverse
synchronizer. It writes only an explicitly selected local SQLite registry and
immutable private asset directory. It never creates a production repository.

```sh
node scripts/issue-migration.mjs export --source https://git.openape.ai --repository openape-ai/openape --output RESTRICTED_NEW_DIRECTORY
node scripts/issue-migration.mjs prepare --snapshot SNAPSHOT_DIRECTORY --mapping REVIEWED_MAPPING.json --history RESTRICTED_HISTORY.json --output NEW_BUNDLE_DIRECTORY
node scripts/issue-migration.mjs validate --bundle BUNDLE_DIRECTORY
node scripts/issue-migration.mjs dry-run --bundle BUNDLE_DIRECTORY
node scripts/issue-migration.mjs apply --bundle BUNDLE_DIRECTORY --database /absolute/registry.db --assets /absolute/issue-assets --destination EXACT_REPOSITORY_ID --approval REVIEWED_APPROVAL.json
node scripts/issue-migration.mjs validate --bundle BUNDLE_DIRECTORY --database /absolute/registry.db --assets /absolute/issue-assets
```

`export` takes `FORGEJO_TOKEN` from the environment. It downloads only same-origin
`/attachments/<uuid>` assets advertised by the approved source, without redirects,
with a 25 MiB per-file ceiling and exact size/hash checks. It compares two complete
API snapshots, including comments, timelines and labels. Per-issue comment listing
ignores pagination on the inspected version; the implementation uses the verified
paginated repository comment collection and checks each issue's count. Failed or
changing exports are discarded and retried into a new directory. M7's source fence
is still necessary: no unfenced multi-request export is a database snapshot.

The separate restricted history input is `{source, repository, rows}` from a
read-only `issue_content_history` query joined to `issue`, scoped to the source
repository ID and `is_pull=0`. Include deleted markers and original text. Inspect
the deployed schema before running it. Do not export the entire Forgejo user/token
DB. Inventory the other deferred tables again at the final fence: the M0 counts
are evidence for their capture date, not an enduring zero claim.

A mapping binds `snapshotHash` (SHA-256 of `JSON.stringify(snapshot)`), the exact
`destination: {id, owner, name}`, and the real operator. Optional `numbers` map source
numbers to explicit new numbers. Optional `identities` entries require `subject`,
`verifiedBy` and independent `proof`; logins do not confer identity. No participant
or repository grant is imported. `assignees` can select a verified source assignee
or explicitly null. Current apply supports verified repository-owner assignment;
other assignments remain unassigned pending a separate eligibility extension.
The manifest also binds the complete mapping file, including identity proof and
reviewer fields, by `mappingHash`; bundle and restore checks reject altered proof.
Each exception needs its exact ID and a reviewed textual disposition. Blocking
restrictions cannot be waived by filling in that text.

The approval JSON binds `manifestHash`, canonical absolute `database` and
`assetsDirectory`, `destinationId`, `approvedBy`, `approvedAt`, and `scope`.
Use `isolated` for rehearsals. Production additionally requires both `--production`
and `scope: "production", productionCutoverApproved: true`; these fields record an
actual separate human decision, not permission to manufacture one. No production
approval file was created in M6. `remove` uses the same binding and refuses a
released batch or native activity. It preserves immutable assets and archives.

Apply requires an empty issue/label destination, or the unchanged locked batch
from the same source. It copies verified immutable blobs and the snapshot,
manifest, mapping and history archive before one SQLite transaction. The batch
transaction replaces only its issue data, handles source deletions, retains stable
IDs, reserves numbers above both source issue and PR occupancy, and reconciles all
rows before commit. A crash resumes by reapplying the complete transaction; there
is no partially visible issue batch. A repeat with the same bundle is equivalent.
A second source cannot silently merge into an occupied home. Native Git/PR/grant
rows and Git refs are outside removal/import statements.

Schema version 4 keeps staged repositories locked. SQL triggers cover issues,
comments, labels, membership, aliases, counters, PR relations, events and assets,
including OLD and NEW repository ownership on updates. The operator temporarily
removes its own lock **inside the same SQLite write transaction** and reinstalls
it before commit. Native handlers return 503 and the UI identifies migration
review. The final release of `issue_import_targets.status` is deliberately a
separately reviewed M7 database operation, after final validation. Once released,
delta import and batch removal refuse to run; rollback must preserve new data.

Downloads use live issue and comment access, private/no-store responses, immutable
hash validation, `application/octet-stream`, attachment disposition, `nosniff` and
sandbox headers. Active files are never served inline. `/api/issue-legacy?url=…`
returns only authorized stable issue/comment links. `/legacy` preserves the old
fragment through the existing login return flow. Raw Markdown is retained; rendered
reference links are resolved from parsed Markdown outside code and only where the
reader can access the target. Source PR links remain source PR links. Imported
identities display explicit Forgejo attribution and are not authenticated actors.

### Verified isolated rehearsal, September 18, 2026

The restricted full source export contains 230 issues, 175 comments, 993 timeline
records, 15 labels, three attachment files and 37 retrievable edit-history rows.
Import and repeated import both reconcile without mismatches. Initial local apply
measured 95 ms; this excludes export and operator review and is **not** a promised
production freeze duration. The first complete manifest hash is
`08b1b1e6900efd117b82ef5721d900a3062bfba96edbe10270cafd154b170bc0`.
The 100 recorded rehearsal-only dispositions comprise 81 unchanged external links
and 19 unassigned source assignments (source IDs 5: eight, 6: two, 1: one, 12: eight).
Production assignment mapping remains an explicit decision. Source users, source
content and credentials are not included in public verification reports.

The modified actual `backup.sh` and `restore-probe.sh` ran against an isolated,
encrypted local restic repository. Restoring into fresh storage verified all 230
issues, 420 origin records, 408 legacy mappings, three byte-exact assets, source
archives, and a cloned synthetic Git repository. Its original ref remained
`cfef76bed51a01ef9048b83cf940de04f3711a64`; snapshot `7c55eba5` is local rehearsal
only. Restic now includes `issue-assets` and `issue-imports` alongside its SQLite
backup, Git repositories and configuration. `verify-issue-backup.py` is read-only.

The real IdP/CLI/browser suite includes a CLI import, protected active-content
download, denied unrelated reader, post-login legacy comment continuation and
read-only imported discussion. A 230-record synthetic HTTP search measured ten
requests with 19.4 ms median and 25.9 ms maximum locally, including live access
filtering and 30-row serialization; another identity receives zero records/count.
These are local observations, not a cross-host performance guarantee. Existing
state/repository indexes support the pilot; no external search engine is added.

### Source write fence and old-link handoff

The disposable pinned Forgejo proof now supports
`OPENAPE_ISSUE_ARCHIVE_PROXY=1 node scripts/native-issues/fence-rehearsal.mjs`.
It combines the existing database triggers (including background close-on-push)
with `archive-proxy.mjs`. Issue, label, comment, repository-delete/transfer,
source-author deletion and attachment mutations receive explicit HTTP 503 before
reaching Forgejo. A real branch push, main push containing `closes #1`, commit
status and Actions run all passed; source issue/comment fingerprints matched.
Removing the disposable fence restored comment writes. The proxy also pauses
standalone Forgejo attachment uploads/deletes because those routes do not carry a
repository identity. This temporary host-wide attachment restriction is a cutover
tradeoff; canonical native PRs and Git/CI remain available. Direct root/database or
filesystem administration cannot be protected by an application proxy and must
remain excluded during the approved maintenance window.

Read-only production topology verification found Forgejo's systemd service using
`/etc/forgejo/app.ini`, listening on `0.0.0.0:3030`, and Coolify Traefik's current
`/data/coolify/proxy/dynamic/openape-services.yml` routing `git.openape.ai` to
`http://10.0.1.1:3030`. M7 must review the exact deployment: bind the Forgejo upstream
to loopback, run the reviewed archive proxy on an explicitly checked private port,
route only the `forgejo` service through it, and verify that the upstream cannot be
reached externally. Do not modify the shared HTTP redirect router or other apps.
`scripts/issue-archive.mjs --config REVIEWED_CONFIG.json` loads the proxy with a
loopback upstream, explicit source repository, reviewed source actors and private
listen address/port. No production configuration or service was changed.

After cutover, `legacyPageFile` can serve the checked
`ops/issue-archive-redirect.html` for the approved source issue HTML routes. The
page preserves the fragment before source authentication and offers a native
resolver link; API archive reads remain available. The file is intentionally
scoped to the primary source repository, not a universal redirect. Another source
needs its own reviewed compatibility mapping. The page/proxy require deployment
and direct-path checks in M7 before old-link continuity is claimed in production.

### Unsupported cases and remaining cutover decisions

- Public or anonymous activation, arbitrary existing-home/many-to-one merges,
  active milestones/projects/reactions/subscriptions/timers, new uploads, and
  full edit-history UI remain outside this MVP. Metadata remains in the archive.
- Locked/confidential issues, missing/unsafe/oversized assets, changed snapshots,
  duplicate labels/numbers and unresolved identity proof block apply. A missing
  history archive blocks manifest preparation. Unrecoverable deleted history
  cannot be recreated. Source-side extension/plugin metadata needs a separate
  inventory before another source is approved.
- The primary snapshot's 19 assignments need approved verified identities or an
  explicit unassigned disposition. The source's 81 external links remain links;
  no external URL was fetched with importer authority.
- Approve the final source/destination manifest, private intake repository and
  product routes, actual deployment/backup capacity, source gateway restriction,
  old-link page and bounded freeze window. Re-inventory Tasks/Plans/worker recipes
  and independently hosted GitHub repositories before their individual cutovers.
- After native writes, freeze native writes and retain both histories before
  deciding forward repair or a reviewed one-time reverse reconciliation. Never
  restore an old registry over newer PRs/grants or re-enable both writers.

## Approved production pilot (M7)

Patrick approved the concrete pilot on September 20, 2026. Preserve the 19
unverified source assignments in provenance and leave their native assignments
empty. Preserve external references without fetching external content. Register
the 17 monorepo product keys and Patrick's private `issue-intake` repository.
Keep source attachments read-only host-wide; also deny source organization
removal and self-service account removal during archive maintenance. Other
repository owners retain separate migration decisions.

Use `sourceFence(verifiedRepositoryId)` from
`scripts/native-issues/source-fence.mjs` to generate the reviewed install and
rollback SQL. This is the same generator exercised against disposable Forgejo
by `fence-rehearsal.mjs`; it additionally protects source repository identity and
source actor deletion. Verify the exact tables/columns on the current source
before applying it. Keep the generated SQL, configuration, actor inventory,
backup identifiers and approvals in the restricted operator evidence directory.
Never infer the source ID from a URL or transplant fixture SQL.

`ops/issue-archive.service` is the systemd unit for the existing gateway.
Verify the host Node path before installation. Install its scripts read-only
under `/opt/openape-issue-archive`, with the reviewed configuration at
`/etc/openape-issue-archive.json` (root-owned, readable by `git`). The example
configuration deliberately omits historical actors and the legacy page: populate
actors from the verified source inventory; enable the fixed-source legacy page
only after the native import and its authentication checks pass. Start and probe
the gateway before switching only Traefik's Forgejo upstream to port 33030.
Rebind Forgejo to `127.0.0.1:3030` so its old bridge address cannot bypass the
fence. Direct database/filesystem administration remains excluded during the
maintenance window. Keep a configuration backup and generated fence-removal SQL
available, but never restore the entire Forgejo/native database over newer Git
or PR activity.

Capture a fresh frozen export and edit-history/deferred-metadata census. New
issues since the September 18 rehearsal must be reconciled and retain numbers.
Only the approved exception types may receive dispositions; other restrictions
halt activation. Apply the bound production manifest to a staged locked target,
validate every row and file, test authenticated legacy navigation, and only then
release the import lock in an explicit transaction. Run another off-site backup
and an independent restore probe. The seven-day observation starts at actual
activation, not at plan approval or merge.
