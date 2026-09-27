# Plan: OpenApe Reports and the Pods morning briefing

<div class="callout callout-info"><strong>Status: Approved by Patrick on September 27, 2026 — implementation in progress.</strong><p>This approved plan is not an implementation or deployment receipt. Patrick's explicit approval authorizes the milestones below, including deployment, a real no-Telegram Pods preview and the existing regular scheduled delivery. Extra Telegram test messages remain excluded.</p></div>

Review URL: [OpenApe Plans](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3HW6FG47VR534XC5EAFNS1R).

## Purpose / Big Picture

Deliver Patrick's existing morning Telegram notification with a link to an attractive, private briefing at `https://report.openape.ai`. Reading requires OpenApe login and ownership. Published editions remain available on phone and desktop over the public internet when the Mac mini is offline.

The existing `apps/openape-testrun` service remains the only report backend and database. Preserve `testrun.openape.ai`, public proof links, archived test versions, test presentation, and the published `ape-testruns` contract. The Dashboard is not a report store. V1 accepts structured briefing data; uploaded HTML, scripts, remote images, a page builder, a new backend and an independent cloud briefing scheduler are excluded.

**Availability boundary:** already published reports are server-hosted. Collection and new publication still require the existing Pods runtime on the Mac. If it is offline at 07:00, the last edition stays readable with a visible date; this plan does not promise a new edition while the generator is offline.

## Repository Orientation

| Area | Verified location and role |
| --- | --- |
| Workspace | `/Users/patrickhofmann/Companies/private/repos/openape`; collection, not a Git repository |
| Canonical Git | `https://repos.openape.ai/patrick/monorepo.git`; bare local repository `openape-monorepo` |
| Inspected main | `53f77a0b81c7870fc27cbb8aa7c089fb7edfb33d`, fetched September 27, 2026; newer than supplied `7315a95cea0611db5fa8df06fb9527c191ae0518`. No changes between these revisions in Testrun, its CLI or nuxt-auth-sp. |
| Implementation checkout | Implementation uses native issue 1397 and isolated `openape-monorepo.worktrees/reports` on `feature/issue-1397-reports`, based on canonical main `53f77a0b`. No existing checkout is switched or cleaned. |
| App | `apps/openape-testrun`: Nuxt 4, Vue 3, Nuxt UI, Drizzle/libSQL; package `@openape-testrun/app`, port 3006 |
| CLI | `packages/ape-testruns`: `@openape/ape-testruns` 0.2.2; preserve executable, flags, default endpoint, output and error contracts |
| Authentication | `modules/nuxt-auth-sp/src/runtime/server/utils/{require-auth,verified-principal,cli-exchange,client-id,sp-config}.ts`; module OAuth metadata route |
| Storage | `server/database/{schema,drizzle}.ts`, `server/plugins/02.database.ts` within the app |
| API and rendering | `server/api/runs/**`, `server/api/public/runs/**`, `server/utils/{run-access,run-shape,markdown}.ts`, `app/pages/r/[slug].vue`, `app/pages/runs/index.vue` |
| Existing tests | App `tests/`, `tests/layout/`, `e2e/cli-roundtrip.e2e.test.ts`, `e2e/proof-link.e2e.test.ts`; CLI `test/cli.test.ts`; auth module tests and shared `openape-e2e/idp-fixture` |
| Deployment | `scripts/deploy-image.mjs`, `compose/chatty.yml`; target `testrun`, image `registry.openape.ai/openape-testrun` |
| Pod source | `openape-pods/pods/calendar-briefing/pod-script.mjs`; installed source is newer than that migration file and must be reconciled before editing |
| Local plan | `/Users/patrickhofmann/Companies/private/repos/openape/.claude/plans/2026-09-27-openape-reports.md`; follows `/Users/patrickhofmann/PLANS-TEMPLATE.md` |

Applicable guidance was read from the collection README, canonical AGENTS.md, the Pods AGENTS.md/README, and the actual mapped vault silos `private-openape` and `private-openape-openape-monorepo`. Current canonical instructions override dated deployment and forge receipts. Use the repository's Vue Composition API convention.

For every implementation shell, enter the isolated checkout and run:

```sh
export OPENAPE_PNPM_BIN=/Users/patrickhofmann/Companies/private/repos/openape/.toolchains/pnpm/10.29.3/bin
export PATH="$OPENAPE_PNPM_BIN:$PATH"
. ./scripts/activate-node.sh
git status --short
git branch --show-current
git rev-parse HEAD
pnpm run doctor
```

Node is pinned to 24.15.0 and pnpm to 10.29.3. Install with `pnpm install --frozen-lockfile`. Local app: `pnpm --filter @openape-testrun/app dev` with an isolated database and the shared disposable IdP fixture for authentication acceptance. Never use production data as a test fixture.

## Verified Live Baseline

| Surface | September 27 observation |
| --- | --- |
| Testrun deployment | On SSH alias `chatty.delta-mind.at`, container `openape-prod-testrun-1`, image `prod-78fad3f1`; health endpoint returns 200 and `ok:true` |
| Rollback pin | `/home/openape/prod/.env`: `TESTRUN_TAG=prod-78fad3f1`, `TESTRUN_TAG_PREV=prod-3f07d0db`; re-read before deployment |
| Persistent storage | Bind mount `/home/openape/projects/openape-testrun/shared`; database `shared/data/testrun.db`, approximately 78 MB |
| Current identity | `NUXT_OPENAPE_SP_CLIENT_ID=testrun.openape.ai`, `NUXT_PUBLIC_URL=https://testrun.openape.ai`, IdP `https://id.openape.ai` |
| Edge | `/data/coolify/proxy/dynamic/openape-services.yml`: Testrun HTTPS router to `http://10.0.1.1:3006`, wildcard TLS; HTTP-to-HTTPS rule includes Testrun |
| Proposed domain | `report.openape.ai` does not resolve and has no observed edge router. Authoritative DNS is Exoscale. Patrick confirmed DNS management through the installed `exo` CLI; `/opt/homebrew/bin/exo` and its DNS commands are available. Nothing was changed. |
| Owning workflow | `5f7ea0d7-1f9c-4c74-8c8a-afd513950001`, “Morgenbriefing · Mail-Prüfung”, revision 6, enabled/unpaused, daily 07:00 Europe/Vienna; next September 28 at inspection |
| Workflow order | Mail review `890bca63-dc4d-4e93-a5cc-cc8c7bfe489d` → sender `991849f7-b612-4cf9-8201-5b78b4a12e55`; handoff enabled |
| Sender | Active, resource epoch 32; own daily schedule disabled, revision 3; checkpoint revision 16. Assignments: o365-cli, repos-issues, Telegram HTTP, calendar_bot_token, scoped Microsoft directory. No Reports HTTP assignment exists. |
| Mail review | Active, resource epoch 57; own 60-second schedule enabled to process already owner-approved archive batches. Workflow runs instead produce `morning-mail-review/v1`. Preserve both behaviors. |
| Independent website Pod | “Daily action website”, `11c24c9f-3efa-469c-a096-c6392f998238`, paused; leave untouched |
| Existing delivery evidence | September 27 original briefing: scheduled sender run `fe6fd6f9-c01d-4134-ab7e-26ca49ca586c`, Telegram message 242, 07:01:32 Vienna, checkpoint/HTTP receipt documented in the calendar README. This is evidence for the old workflow, not Reports acceptance. |

The current sender collects two calendars and open repository issues, then consumes mail-review output. It checkpoints the full pending Telegram message before POST, uses `calendar-briefing:<chatId>:<Vienna date>`, stores digest effect receipts, and blocks automatic resends after uncertainty. Manual runs do not send. Mail summaries and source links already exist in the review output; no second mail classifier is needed.

## Architecture and Report Contract

### Report types and storage

Keep the existing runs/versions/assets storage and slug mechanism. Introduce a discriminated domain model: `test` and `briefing`. Missing type on existing test manifests means `test`. Existing rows and versions are migrated explicitly to `test` with `shared` visibility. Briefings are always `private` in V1; neither a payload flag nor a test upload can change a private series into a shared one.

Add report type, visibility and authenticated owner identity to the series record, plus edition date, generation time, content digest and publication identity to briefing versions. Ownership and visibility are immutable across all versions of a series. Retain `created_by` and actor provenance without rewriting old uploader identities. A same-named test series and briefing series must be separate namespaces.

Test status remains exactly passed/failed/skipped. Briefings do not contain fake tests or fake passing statuses. Make test-only status/count data optional for briefing records using an explicit, transactional SQLite migration where existing NOT NULL constraints require table reconstruction. Preserve every existing ID, slug, version, asset byte and test field. Inspect indexes before adding constraints; do not merge or delete duplicate legacy series as a cleanup. Add uniqueness for briefing owner/series and owner/series/edition only, plus publication idempotency. Migration failures fail startup visibly.

### Structured payload

New `POST /api/reports` accepts an authenticated briefing publication, while legacy `POST /api/runs` retains its test-only contract. An owner first creates a private series through `POST /api/report-series`. Proposed briefing payload:

```json
{
  "schemaVersion": 1,
  "type": "briefing",
  "seriesId": "server-created-private-series-id",
  "editionDate": "2026-09-28",
  "timezone": "Europe/Vienna",
  "generatedAt": "2026-09-28T05:01:00Z",
  "title": "Morning briefing",
  "overview": "A short overview based on the collected sources.",
  "importantItems": [],
  "nextActions": [],
  "calendar": [],
  "emails": [],
  "issues": [],
  "sources": [],
  "gaps": []
}
```

Arrays contain bounded objects, not Markdown/HTML blobs:

- Important items: stable ID, title, plain-text summary, priority and source IDs.
- Next actions: stable ID, text, optional explicit due date, source IDs and optional safe source URL. Reading does not execute an action.
- Calendar: ID, account label, title, start/end with explicit timezone or all-day date, location and optional source URL.
- Emails: ID, account, sender, subject, receivedAt, existing disposition, summary, nextAction and source URL. Retain the existing archive-review URL as a clearly named external approval link; opening a report never grants or archives mail.
- Issues: repository, issue number, title, state, updatedAt and validated canonical URL. Preserve the collector's total and top-ten limit; label the subset instead of claiming completeness.
- Sources: ID, label, collectedAt, status (`fresh`, `stale`, `missing`, `error`, `partial`), coverage/count/limit and optional source URL.
- Gaps: source ID, plain-language reason and last successful observation when known. Empty and unavailable are distinct states.

Reject unknown control fields, body-supplied owner/actor/visibility, invalid dates, invalid source references and excessive sizes before persistence. Initial limits: 60 KiB serialized request, 300-character titles, 2,000-character text fields, 50 important items/actions, 100 calendar events, 20 emails, 50 issues, 20 sources/gaps. Validate byte length in the Pod and server; do not silently truncate. Every display field uses escaped Vue text. Links permit HTTPS only without embedded credentials; missing/invalid links render explanatory text, never executable URLs. No remote image loading, iframe, script, HTML interpretation or server fetching of report URLs.

### Latest, history and atomic publication

Continue using `/r/<slug>` for latest and `/r/<slug>?v=<n>` for an immutable archived edition. Return both `url` (latest) and `edition_url` (pinned) from publication. The Telegram notification includes the dated edition URL and a short “Latest briefing” link; the report exposes a date-based edition selector and a visible stale-date message. The authenticated Reports home provides the stable latest link.

Briefings have no uploaded assets in V1, so one transaction can validate, allocate version, archive the previous head, write the complete new head, record its digest/idempotency receipt and advance latest. New content is never visible before commit. Concurrent retries are serialized by database constraints and a transaction, not only a process-local lock.

Require an `Idempotency-Key` bound to the verified owner, publisher and series, with the Vienna edition date. Identical retries return the original edition/version; changed content under the same key or a different key for an existing daily edition returns 409. Freeze payload and timestamp in the Pod before its first request. Do not regenerate the report on retry. A late older date must not replace a newer latest edition. Corrections to an already published edition need an explicit future workflow and are outside automatic V1 behavior.

Add authenticated `GET /api/report-series/:id/editions/:date/publication` returning only digest, ID, version and URLs to the assigned publisher. This reconciles a lost POST response without repeating an uncertain effect. Publication receipts have no mail contents. HTTP 201 means first publication, 200 means verified identical replay; failed publication leaves the previous latest unchanged.

## Access Control and Identity

1. An owner creates a series with the existing verified OpenApe browser session or exchanged SP bearer. Persist owner from the verified principal, never from the request body. Patrick's OpenApe identity is `patrick@hofmann.eco`; mailbox addresses are separate identities.
2. Reuse `requireScopedPrincipal` for new owner operations. Define explicit catalog-only `reports:read`, `reports:publish` and `reports:manage` scopes so unrelated legacy write scopes do not authorize Reports mutations. Browser mutations require same-origin checks; enforce bounded requests and publication rate limits.
3. The Pod is a publisher, not the owner. Bind a dedicated authenticated DDISA publisher subject to this series through an owner-authenticated operation. Store the owner from that session, the exact publisher subject and its restricted publish/receipt rights. The publisher cannot list/read report contents, alter ownership, delete reports, or publish another owner's series. Revocation takes effect on the next request.
4. Use the installed Pods `ddisaAgent` HTTP authentication: an assigned encrypted private key, subject and issuer; runtime injects Authorization. Provision/reuse only an appropriate dedicated identity through the normal OpenApe account flow. No host login-store copying, bearer values in scripts, or use of the Telegram secret for publication.
5. **Auth feasibility gate:** installed `ddisaAgent` currently emits an IdP client-credentials token, while `requireScopedPrincipal` accepts exchanged SP tokens. They are not interchangeable. Implement a narrowly scoped publisher verifier by reusing the existing DDISA subject discovery/JWKS verification facilities and protocol rules: verify signature, authoritative issuer, expected audience, expiry and exact subject before the stored binding is considered. Never use unverified claims or the legacy permissive raw-token fallback. Prove the actual issued audience and renewal path in M1. Any required protocol change or broader Pods runtime refactor requires a plan amendment before proceeding.
6. Centralize authorization in a `loadVisibleReport`/equivalent helper used before serialization, version enumeration or asset lookup. Apply it to public-named legacy APIs as well: their names do not exempt private rows. Protect page SSR, Nuxt payloads, management detail/list/delete/upload, new APIs, direct asset routes, archived assets, HEAD/conditional requests, and both domains. Legacy test management endpoints either filter to tests or explicitly deny briefing IDs.
7. Anonymous private APIs/assets return 401 without content; a different signed-in owner receives 404 without existence metadata. The page shows a generic login screen and returns to the original local path/query after successful login. Invalid return URLs are rejected. Authorization runs before ETag/304 or range responses.
8. Private success and denial responses use `Cache-Control: private, no-store` and appropriate `Vary` headers; no CDN/shared caching, pre-rendered private payloads, content in social metadata, analytics or error logs. Use noindex and no-referrer. Disable Telegram link previews. Keep public test asset cache behavior for shared tests.

### Domain compatibility

Manage DNS through the installed `exo` CLI. Inspect its configured account and the existing `openape.ai` zone using documented read commands; do not infer the account from another project. After approval, add the `report.openape.ai` A record pointing to the verified Chatty address, preserving unrelated records. Configure routing on `chatty.delta-mind.at` through its SSH alias: add an explicit HTTPS Traefik router in `/data/coolify/proxy/dynamic/openape-services.yml` to the existing Testrun backend, plus HTTP-to-HTTPS. Recheck current DNS records and certificate coverage before writing. Keep the existing Testrun domain and routing intact.

Keep the canonical CLI/SP bearer identity and test URL base `testrun.openape.ai`; add a separate configured briefing URL base `https://report.openape.ai`. Browser login on the alias must be explicitly supported: publish the two reviewed callback origins through the shared OAuth metadata implementation while keeping host-only cookies and strict return-path validation. Do not solve this by trusting arbitrary Host headers, wildcard redirects or changing CLI token audience. The M1 IdP fixture must prove callback acceptance for both domains; read the DDISA specification before module changes. If the existing protocol rejects this alias configuration, amend the plan instead of weakening validation.

## Design Preview

<div class="callout callout-info"><strong>Illustrative content only.</strong> The cards below are a layout sketch, not a production screenshot or real mail data.</div>
<div class="card"><p class="meta">OPENAPE REPORTS · PRIVATE · MONDAY, 28 SEPTEMBER 2026</p><h2>Your morning, in one place</h2><p class="lead">Two items need your attention. Your first appointment starts at 09:30.</p><p class="meta">Generated 07:01 · Europe/Vienna · Latest edition · Light / Dark / System</p></div>
<div class="grid"><div class="card"><span class="badge badge-warn">Attention</span><h3>Confirm the project review</h3><p>A reply is still needed. Check the source message before confirming.</p><p><strong>Next action:</strong> Review the proposed time.</p><p class="meta">Example mail · received 27 September · Open source</p></div><div class="card"><h3>Today's calendar</h3><p><strong>09:30–10:00</strong> · Project review</p><p><strong>14:00–14:30</strong> · Planning</p><p class="meta">Both configured accounts · Today and upcoming days</p></div></div>
<div class="card"><h3>Relevant mail</h3><p>Sender · Subject · Received date</p><p>A concise existing summary, followed by the next action and a source link.</p><span class="badge badge-neutral">Archive suggestions require your existing approval</span></div>
<div class="grid"><div class="card"><h3>Open repository issues</h3><p>Repository · #Number · Title · Updated date</p><p class="meta">Showing the collected subset; total count remains visible.</p></div><div class="card"><h3>Source coverage</h3><p><span class="badge badge-success">Current</span> Calendar · checked 07:00</p><p><span class="badge badge-warn">Partial</span> One mailbox review is incomplete.</p><p class="meta">A missing source is never presented as “nothing to do”.</p></div></div>

Use a quiet editorial layout: warm neutral background, near-black text, restrained blue accent, amber only for attention/data gaps, subtle borders, generous whitespace. Phone: one column with important items first; desktop: a readable main column plus calendar/source rail. System font stack, 16–18 px body, generous line height, maximum readable line length, 44 px tap targets, visible focus, clear heading hierarchy and sufficient contrast. Dark mode uses deep neutral surfaces and readable muted text. Respect system preference; offer a persistent explicit theme choice. No external fonts or trackers. Actual briefing content remains German; technical documentation, source, comments and tests are English.

## Milestones

### M0 — Plan and approval

**Work:** inspect canonical source, mapped memories, live deployment, domains, installed scripts/resources and workflow; publish this proposal to OpenApe Plans with the preview sketch.

**Acceptance:** the local body and remote draft match; a concrete approval request is presented. No product implementation, workflow execution, schedule changes, DNS writes or Telegram test sends occur.

**Rollback:** archive the draft if rejected; no production change to undo.

### M1 — Compatibility, identity and privacy foundation

**Work:** create the canonical development issue and isolated branch/worktree after approval. Record current HEAD and baseline tests. Implement the typed storage migration, private visibility choke point, strict publisher binding/verification, alias OAuth metadata and legacy endpoint filtering. Keep briefing publication disabled. Build a minimal authenticated fixture to prove both login hosts, owner identity, direct publisher token renewal and rejected cross-owner access. A publisher setup flow may use the authenticated API; a general access-management product UI is not required.

**Acceptance:** real CLI upload remains compatible; test reports and assets still render; migration preserves existing rows/assets; a synthetic private row is denied through every legacy/new route for anonymous and other-owner requests. An unbound or revoked publisher cannot publish. Alias login returns to `?v=` correctly. Forged owner fields and wrong issuer/audience fail.

**Rollback:** development changes can be abandoned before rollout. No private production rows are written yet. If the token or callback feasibility gate needs broader work, stop that dependent milestone and update this plan for approval.

### M2 — Atomic briefing publication and edition history

**Work:** add `briefing-shape.ts`, publication transaction/service, series management, publication receipt lookup and report serializers within the same app. Implement the proposed field limits, immutable editions and owner/publisher checks. Do not add an HTML upload route or require a new CLI release.

**Acceptance:** first publication produces version 1; the next date produces version 2 with the same slug; `?v=1` retains its date/content. Parallel identical publications make one edition. Conflicting payloads produce 409. Injected transaction failures and lost responses do not create incomplete/latest editions or duplicate versions. Old dates cannot regress latest. Unsupported and oversized content is rejected without writes.

**Rollback:** publication remains disabled in production. Retain additive migration state; do not rewrite historical test data.

### M3 — Briefing UI and browser acceptance

**Work:** keep test presentation in its own component and introduce briefing components with controlled rendering, responsive layout, date navigation, theme controls and explicit data gaps. Update the Reports landing/library while retaining existing test navigation and URLs.

**Acceptance:** directly inspect screenshots at 390×844 and 1440×1000 in light and dark modes, using actual app CSS and real authenticated fixture login. Verify long titles/URLs, empty calendars, partial mail data, timezone/DST dates, stale latest edition, keyboard focus and archive navigation. Script/HTML/event-handler/unsafe-URL payloads never execute or cause remote image fetches. Existing report geometry checks pass.

**Rollback:** revert briefing UI commits or disable its entry points; privacy controls remain.

### M4 — Reviewed deployment and domain migration

**Work:** native PR(s), explicit issue relations, exact-head external unit checks and reviewed source/target SHAs. Push only to canonical origin; preserve Forgejo/GitHub mirror pipeline. Before deployment run `pnpm check:ci` from clean merged canonical main. Take an SQLite-consistent backup, record the current image/config/route pins, and rehearse migration/restore on an isolated database.

Deploy a privacy-aware baseline with publication disabled first, using `pnpm deploy:image testrun --dry-run` followed by `pnpm deploy:image testrun`. Then deploy the full Reports image while keeping that privacy-aware image as the tested rollback target. Run the privacy baseline against the final schema as part of rollback rehearsal. Use `exo` for DNS and the existing Traefik configuration on Chatty for routing, as confirmed by Patrick. Review and record DNS/Traefik/environment changes; do not overwrite unrelated routers or environment values. Add the alias only after routing, TLS and login checks pass. Store operations changes in the native PR/runbook.

**Acceptance:** both HTTPS hosts are healthy; original public report and archived-asset links still work; current installed CLI and repository-built CLI upload synthetic tests through the normal flow. Private synthetic reports pass the full negative access matrix on both hosts. Login and TLS work without Tailscale from an independent public-network probe. Stored pages have no Mac-hosted asset dependency. DB backup integrity and privacy-safe rollback rehearsal pass.

**Rollback:** before any private production content, the original image is permissible. After private data exists, only the rehearsed privacy-aware baseline or a fixed-forward image is permissible. Never start `prod-78fad3f1`/`prod-3f07d0db` against private rows. If no safe image is available, stop service access while repairing rather than expose private data. A full DB restore over newer reports is not an ordinary rollback. Revert only the new DNS/router entries if needed; preserve Testrun.

### M5 — Existing Pods workflow integration and authorized preview

**Work:** re-read current runtime, workflow revision, both active scripts, resources, schedules and pending effects. Reconcile the current installed sender into the one local `pod-script.mjs` (strip only its generated binding trailer). Preserve the mail-review script, Jev decisions, protected senders, archive preparation and separate approval processor. Do not edit assigned program files in place; they are hash-bound.

Provision the owner-bound private series and dedicated publisher. Assign only Reports HTTPS GET/POST and its encrypted authentication to the existing sender through the supported current-revision MCP flow. Reuse calendar, issue and `morning-mail-review/v1` data. A normal report reuses the review's important emails and all reported gaps; no reclassification, grant consumption or archival is added.

Implement this durable sender order:

1. Preserve the existing delivery date, full pending Telegram state and receipts; refuse automatic send if uncertainty already exists.
2. Collect/validate current data, same-day workflow review and explicit coverage. Missing mandatory calendar/issue reads or missing same-day review still stop normal delivery as today. Known partial mail review can publish with prominent gaps. Never silently reuse yesterday's input.
3. Freeze the structured payload, date, digest and publication key in a separate `reportPublication` checkpoint field without clearing delivery state.
4. Publish using `context.http.request`, stable key and `receipt: 'digest'`. Keep within the installed runtime's 65,536-character request limit. Save the returned edition identity, then verify its committed receipt through authenticated GET.
5. If publication response is missing/uncertain, query the receipt by date/digest. A matching receipt proves publication; resolve the existing effect through the supported recovery operation with that evidence. Absence or mismatch does not authorize a blind POST retry or a new key. Keep Telegram unsent.
6. Only after confirmed publication, checkpoint the short Telegram text with pinned/latest URLs. Reuse the exact existing Telegram daily key and digest receipt behavior. Disable link previews. Preserve indefinite blocking after uncertain Telegram send, including on later dates.
7. On verified provider receipt, save Telegram message ID/date/chat/run and report ID/version/digest together. A delivered date is never sent again because only report rendering changed.

Manual sender/workflow runs remain no-Telegram previews. Add an explicit preview-publication mode using a separate owner-private preview series; it cannot advance the daily live series. Run one real authorized workflow preview, with the mail node's existing manual semantics (no archive grant creation/consumption), publish that preview report, and inspect it through owner login. Prefer this single combined preview over repeated standalone source reads. Runtime permission prompts, if required, must describe exact resources and stay within this approved scope.

**Acceptance:** actual installed Pod run IDs and authenticated publication receipt demonstrate working credentials, real source reads and server publication; Telegram POST count remains zero for this preview. Existing mail decisions/approval processing remain intact. Publication failure, digest-only replay, uncertain delivery, duplicate date, restart and date rollover pass established behavioral tests. Only after this succeeds enable Reports publication in the existing scheduled sender. Keep exactly one 07:00 owning workflow, sender schedule disabled, mail approval polling unchanged and “Daily action website” paused.

**Rollback:** disable only new report publication or restore the previous validated sender through Pods history with current resource validation. Reconcile all pending report/Telegram effects first, retain all checkpoint fields and receipts, and do not manually send. Preserve the owning workflow schedule and mail approval poll. If the old text sender is restored, its existing per-day receipt prevents a second same-day delivery.

### M6 — First regular scheduled delivery and closeout

**Work:** observe the first 07:00 Europe/Vienna workflow after the cutover; the inspected next date is September 28 but the actual acceptance date depends on implementation completion. Use read-only follow-up checks, not a second trigger or synthetic schedule. If this spans sessions, create one permitted read-only follow-up with no ability to run/send or change the workflow.

**Acceptance:** record the workflow `reason=schedule`, sender run, report commit time before Telegram POST, private edition/version/digest, provider `ok=true` with matching destination/message ID, matching durable checkpoint and completed digest effect. Inspect the owner-visible latest/dated report, test anonymous denial from public internet, and confirm next daily schedule plus inactive duplicate senders. An empty recovery list alone is not proof of delivery. Pending source/auth/publication/delivery failures keep this milestone open.

**Rollback:** use M5 recovery; never automatically resend an uncertain Telegram outcome. Leave a precise issue update if the regular run needs intervention.

Report **implementation**, **deployment**, and **live acceptance** separately. Close the native development issue manually only after all agreed acceptance is complete. No live acceptance claim may be based on fixture tests, a manual preview or the original September 27 message 242.

## Verification Commands and Evidence

Use existing suites and runners; no new package scripts or default test-chain changes. Before committing, full `pnpm lint` and `pnpm typecheck` must pass. Then build the affected app and run its relevant tests; stop and repair the first failure. Build shared consumed packages serially where needed.

```sh
pnpm check:affected --base origin/main --head HEAD --dry-run
pnpm lint
pnpm typecheck
pnpm --filter @openape-testrun/app build
pnpm --filter @openape-testrun/app test
pnpm --filter @openape/ape-testruns test
pnpm --filter @openape-testrun/app test:e2e
pnpm --filter @openape-testrun/app test:layout
```

Extend the existing app unit/component, HTTP/E2E and layout suites for consequential contracts: private resource denial, publisher identity/revocation, atomic/idempotent editions and unsafe rendering. Retain these tests because they protect private mail and prevent duplicate external delivery; explain that choice in the PR. Extend auth-module tests if its metadata/verifier is changed. Keep the automatic CI policy unit-only; E2E/layout above are manual acceptance for this change. Do not duplicate already completed exact-head external gates.

Capture real browser screenshots with production CSS and authenticated fixture login, inspect each image directly, and publish only synthetic verification evidence through `ape-testruns`. Keep personal briefings, source snapshots, keys and real mail screenshots off public proof links. Save redacted CLI/API receipts, exact tested SHA/commands/results, and a self-contained verification HTML locally. Use the existing Pod test harness for script behavior; live preview is separate from synthetic validation.

## Progress

- **Done:** 2026-09-27: Workspace/repository instructions and both mapped memory indexes read.
- **Done:** 2026-09-27: Canonical main, Testrun source/contracts, deployed image/storage, domain and edge configuration inspected read-only.
- **Done:** 2026-09-27: Current workflow, installed sender/mail scripts, assignments and schedules inspected through Pods MCP; no run started.
- **Done:** 2026-09-27: Implementation/migration proposal written locally.
- **Done:** 2026-09-27: Published remote draft `01M3HW6FG47VR534XC5EAFNS1R`; authenticated browser rendering and the preview cards inspected directly.
- **Done:** 2026-09-27: Owner clarified DNS through `exo` and routing on Chatty; deployment instructions updated. This clarification does not constitute implementation approval.
- **Done:** 2026-09-27: Patrick explicitly approved the plan in this conversation.
- **In progress:** M1: [Issue 1397](https://repos.openape.ai/patrick/monorepo/issues/1397) and isolated worktree created. Privacy rollback baseline merged through PR 157 at `183395e40aa278b1af2510152300c067c5a6d672` after exact-head external CI. Full lint/typecheck/build, 20 unit and 10 E2E tests passed. Clean release checkout passed `pnpm check:ci` (`1790529449682-183395e4-unit/summary.json`). Deployed `prod-183395e4` on Chatty; health and SQLite integrity pass, all 282 runs / 168 archives / 691 assets preserved. Existing proof JSON is byte-identical before/after. Consistent protected backup: `/home/openape/backups/reports-2026-09-27/testrun-before-baseline.db`, SHA-256 `0adc3911911a0162618ca2b1d2072fbfaf19d3f9bf4fb9ed3b2765e17dfafc6d`. Auth and private briefing implementation continues on `feature/issue-1397-briefings`.
- **Done:** M2: Atomic daily publication, replay/conflict handling, archive and latest views implemented; 45 app unit tests and 107 auth-module tests pass. The actual Pods DDISA token and renewal flow are exercised against the disposable IdP.
- **Done:** M3: 14 real HTTP/CLI/browser E2E tests pass. Desktop 1440px and mobile 390px screenshots in both themes inspected directly, including approval links and dated editions. [Published synthetic screenshots](https://testrun.openape.ai/r/AeJDx48LWOG_vVrS_KKBgCsv). Self-contained synthetic evidence is generated in `.artifacts/reports/report.html`.
- **Done:** Safe rollback rehearsed: baseline `183395e4` starts against the final schema, retains shared report access and denies private head/archive/asset/page contents. Full root lint/typecheck and both affected app builds pass; 600 Pods unit tests and four CLI tests pass.
- **Pending:** M4: Privacy-safe deployment and domain activation.
- **Pending:** M5: Actual no-send preview and workflow integration.
- **Pending:** M6: First regular scheduled Reports delivery.

## Surprises & Discoveries

- The existing public asset route sends `public, max-age=31536000, immutable`; private assets must never inherit it. Evidence: `server/api/public/runs/[slug]/assets/[...path].get.ts` at inspected main.
- Series updates currently archive and update in separate statements, and publish before asset PUTs. Reusing that sequence directly would not satisfy atomic briefing publication. Evidence: `server/api/runs/index.post.ts`.
- The installed sender differs from the older local migration script and already consumes mail-review output. Runtime is the source for reconciliation; preserve its newer behavior.
- There is one daily owning workflow plus a distinct 60-second archive-approval processor. Removing that processor in pursuit of “one schedule” would break existing owner approvals.
- The current auth helper and the Pods HTTP token are different credential forms. Ownership cannot be inferred from an agent email or body field; the plan includes explicit owner-created publisher bindings and an auth feasibility gate.
- A plain image rollback would expose private rows through old public handlers. A tested privacy-aware rollback image is required before private publication.

## Decision Log

| Date | Decision | Reason | Alternatives rejected |
| --- | --- | --- | --- |
| 2026-09-27 | DNS through exo CLI; routing on Chatty | Owner-confirmed existing infrastructure | Another DNS provider or hosting target |
| 2026-09-27 | Extend Testrun in place | Owner's architecture decision; established remote storage and report links | Separate backend or Dashboard report store |
| 2026-09-27 | Keep app/package/image and CLI identities | Compatibility and existing deployment pipeline | Rename every package/domain/token audience |
| 2026-09-27 | Structured, asset-free briefing V1 | One transactional publication and controlled rendering | Arbitrary HTML/JavaScript or raw mailbox HTML |
| 2026-09-27 | Owner-created private series, restricted publisher | Verified ownership without trusting agent-supplied owner data | Slug secrecy as private access control |
| 2026-09-27 | Freeze one edition per Vienna day | Safe retries and stable history | Blind version increments on every retry |
| 2026-09-27 | Preserve uncertain-send blocking | Existing external-effect safety contract | New keys or automatic resend after timeout |
| 2026-09-27 | Privacy baseline before private content | Safe rollback with persisted private data | Rolling back to pre-auth Testrun |

## Session Checklist

1. Read this plan, Progress and the canonical repository AGENTS.md; re-resolve memory mapping for the isolated checkout.
2. Record branch/HEAD, changes since the last session, current issue/PR and external check state in `docs/agents/active-work.md`.
3. Activate the pinned toolchain; run doctor and the next milestone's proportionate baseline checks.
4. Re-read current Pod/service revisions before any mutation. Preserve other sessions' work and current source files.
5. Work on the next open milestone, commit with Conventional Commits and keep the local/Plans body aligned.
6. Verify observable UI/API behavior with the established infrastructure; inspect screenshots directly.
7. Update Progress, evidence, decisions and next step; log substantial progress. A fresh session is recommended at implementation start and milestone boundaries.

## Outcomes & Retrospective

Implementation and local acceptance are complete. The privacy baseline is deployed; the full Reports rollout, actual Pods preview and scheduled acceptance remain pending. Complete this section after M6 with actual delivered behavior, deviations, verified receipts and lessons.
