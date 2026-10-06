# OpenApe Reports

OpenApe Reports stores client-authored private documents, shared test reports and compatible private structured briefings. Package, image, database and CLI identity remain `openape-testrun` / `testrun.openape.ai`. `report.openape.ai` is the general reading entry point; `ape-testruns` and old `/r/:slug?v=N` links are unchanged.

## Reading surface

`/reports` is one library of HTML documents and earlier uploads (search with `/`,
categories, tags, a filter sheet) backed by `GET /api/library`; `/reports/removed`
restores removed reports privately. `/d/ID` and `/r/SLUG` give the report the whole
window below a 48 px bar, with a Details drawer. There is no browser editor; see
[reading and finding reports](../../docs/operations/single-html-reports.md#reading-and-finding-reports--issue-1433).

## Generic client documents

Enable new publishing with `NUXT_DOCUMENT_PUBLISHING_ENABLED=true` after the migration
and rollback acceptance. It defaults off; disabling it preserves all persisted data
and compatibility adapters. The [migration matrix](../../docs/operations/generic-reports-migration.md)
records rollout state and evidence.

`POST /api/reports` also accepts document/v1 with a stable `Idempotency-Key`.
Clients supply title, static HTML, CSS, optional language/category/series and bounded
raster assets. See the [complete envelope and CLI contract](../../packages/ape-testruns/src/docs/documents.md).
Each document has its own immutable private link; calendar dates do not define identity.
Retries compare original request bytes and reuse the persisted sanitized artifact.
The receipt includes distinct request/artifact SHA-256 hashes and sanitizer policy.
An optional series orders editions without applying the legacy briefing daily rule.

HTML is parsed by the existing maintained `sanitize-html` dependency. PostCSS and
postcss-value-parser (already resolved in the repository, now explicit dependencies)
parse client CSS; no regex sanitizer is used. HTML scripts, executable attributes,
forms, namespaces, metadata overrides and navigation are excluded. CSS fetches and
unsupported functions/at-rules are removed, escapes/markup rejected. Static CSS stays
inside a sandboxed iframe without scripts or same-origin privileges. The authenticated
HTML response also carries sandbox CSP, private/no-store and nosniff, including direct
navigation. Images are verified PNG/JPEG/WebP bytes embedded in that private response;
there is no raw original-HTML route or external resource fetch.

`GET /api/reports` lists only the owner's accessible reports with category keys/counts,
filters and pagination. Legacy briefings map to Briefings, tests to Test Runs, absent
categories to Uncategorized. New bounded NFC labels appear on first publication.
`POST /api/reports/preview` returns the same isolated artifact without persistence.
`GET /api/reports/publication?key=KEY&seriesId=ID` reconciles exact receipts for the owner
or currently bound publisher. The legacy audience remains `testrun.openape.ai`.

Screenshot PUT validates raster signatures; response MIME is derived from bytes for
both new and historical assets. Unsupported historical bytes remain downloadable as
attachments with nosniff and sandbox rather than executable content at the app origin.

## Contracts

- Legacy `POST /api/runs`, assets, lists and delete operate on shared tests only. Missing report type is a test. Test statuses remain passed/failed/skipped.
- `POST /api/report-series` accepts `{name}` from a verified owner and idempotently returns that owner's series. Ownership is never accepted in a body.
- `PUT /api/report-series/:id/publisher` accepts `{publisher: email | null, expectedRevision}` from the owner. A direct DDISA agent may publish and reconcile receipts only for explicitly bound series. Revocation is reevaluated inside publication transactions.
- `POST /api/reports` requires a stable `Idempotency-Key` and the version-one [briefing contract](shared/briefing.ts). Request limit: 60 KiB UTF-8. Strict validation rejects unknown fields, invalid source references, dates and non-HTTPS/credential-bearing URLs. Text is rendered through escaped Vue interpolation; no uploaded HTML, JavaScript or remote images.
- `GET /api/report-series/:id/editions/:date/publication` returns digest, publication ID, version and links to the owner or bound publisher, without mail content.
- `/r/:slug` resolves the latest committed edition; `?v=N` selects an immutable edition. Private JSON, pages, assets and archives require `reports:read` plus owner authorization. Unknown owners receive 404; anonymous requests receive 401. The raw publisher token cannot read content.
- Private responses and report pages use `private, no-store`, noindex and no-referrer. Shared test assets retain their existing public cache behavior.

One SQLite write transaction archives the previous head, replaces it and records the daily publication receipt. Database uniqueness constraints enforce one owner-created series/name, one edition/series/date, one idempotency key/series and one version/series. An in-process queue avoids overlapping libSQL transactions on one client; the transaction and constraints also protect storage independently. Matching retries return the same ID/version; conflicting or older editions return 409. The digest covers the exact UTF-8 request body, so publishers must freeze that body before their first request.

The signed SP session or exchanged bearer establishes owner identity. The dedicated publisher path discovers the authoritative issuer through DDISA and verifies asymmetric signature, issuer, `apes-cli` audience, subject, expiration and direct agent claims. Delegated/scoped raw tokens are rejected. JWKS fetches are public-URL checked, bounded, time-limited and refuse redirects. The existing legacy authentication fallback never authorizes private viewing.

## Briefing language and mail presentation

The morning sender and briefing controls use German. Original source subjects and repository titles retain their source language. Published report bodies are immutable: changing the recipe affects the next edition and separate previews, not a previously delivered snapshot.

Mail summaries and next actions appear together in one mail section. The renderer also suppresses exact mail summaries/actions duplicated by older sender versions while retaining unrelated important items and actions.

The mail-review recipe reads each selected conversation across inbox and sent messages before suggesting an action. It selects at most five distinct conversations per account, refreshes their context on every review (even when an inbox message version is unchanged), and passes chronological evidence to both Jev and the German summary. An owner reply can satisfy a request, but a remaining promise or a newer question can still require action. Missing, truncated or oversized context produces an explicit gap and no reply task. This separate briefing review cannot add archive candidates or change the owner approval process.

## Deployment and rollback

Use canonical native PRs and the established tested-image pipeline. Run full lint/typecheck, the app build and relevant tests before commit; exact-head external CI is the merge gate. Before deployment, use clean merged canonical main and `pnpm check:ci`, then `pnpm deploy:image testrun --dry-run` and `pnpm deploy:image testrun`.

The privacy baseline `prod-183395e4` is already deployed and is the minimum safe rollback image. **Never run `prod-78fad3f1`, `prod-3f07d0db` or any older unguarded image against private rows.** The final migration makes test-only status nullable by a transactional table rebuild, preserving columns, rows, indexes and triggers. Keep the consistent pre-rollout database backup; never restore it over newer reports as routine rollback.

Compose sets `NUXT_BRIEFING_URL=https://report.openape.ai`. Keep `NUXT_OPENAPE_SP_CLIENT_ID=testrun.openape.ai` and `NUXT_PUBLIC_URL=https://testrun.openape.ai`. The shared OAuth metadata explicitly lists report alias callbacks; no wildcard or arbitrary redirect is accepted. Cookies remain host-only. The local loopback callback exception requires the existing insecure IdP fixture flag, never set in production.

DNS: Exoscale account `delta mind`, existing zone `openape.ai`; verify existing records, then add only `report` A → `85.217.175.26` with TTL 300. Routing: SSH alias `chatty.delta-mind.at`, dynamic file `/data/coolify/proxy/dynamic/openape-services.yml`. Add the following router under existing `http.routers`, using the existing `testrun` service and certificate anchor, and add the host to the existing HTTP redirect rule:

```yaml
reports:
  rule: "Host(`report.openape.ai`)"
  entryPoints: [https]
  service: testrun
  tls: *tls-openape-ai
```

Back up the router file and inspect its current contents before a targeted atomic edit; preserve unrelated routers. Test TLS/routing with `curl --resolve` before DNS publication. Verify both domains, metadata and owner login after publication. Rollback removes only the new alias entries or restores the tested privacy baseline; it retains Testrun routing and the database.

## Pods integration

[Approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3HW6FG47VR534XC5EAFNS1R) · [issue 1397](https://repos.openape.ai/patrick/monorepo/issues/1397).

The existing `Morgenbriefing · Mail-Prüfung` workflow (`5f7ea0d7-1f9c-4c74-8c8a-afd513950001`) owns daily 07:00 Europe/Vienna. The sender is `991849f7-b612-4cf9-8201-5b78b4a12e55`. Its standalone daily schedule stays disabled. The mail review's 60-second approval processor remains enabled. `Daily action website` stays paused.

The [sender recipe](../openape-pods/examples/morning-mail-briefing.mjs) consumes existing calendar/issue reads and `morning-mail-review/v1` output, including its exact archive-approval links. No classifier, mail write or model call is added. Missing sources and stale reviews are labeled. Preview publication uses a separate owner-created series; manual runs never send Telegram.

Assign `https://report.openape.ai` with GET/POST and DDISA authentication using the dedicated `reports-briefing` agent's imported private key. The script never reads this key or sets Authorization. Configure ordinary `reports_url`, `reports_series_id`, `reports_preview_series_id` and `publication_mode` (`preview` during acceptance, `live` afterward). Keep all previous variables, resources and checkpoints.

The sender freezes body/digest/key in `pendingReport` before POST and verifies the persisted receipt before preparing Telegram. Known HTTP 5xx responses may retry with a new local effect-attempt suffix, always retaining the same server idempotency key/body and checking the receipt first. An uncertain transport result never receives a new effect identity. If the native runtime blocks an unknown publication effect, reconcile its GET receipt/digest through owner-authorized recovery before retrying the same pending operation. A conflicting daily edition requires explicit investigation; do not overwrite it or create a new automatic edition.

Telegram retains `calendar-briefing:CHAT_ID:DATE`, its pending-message checkpoint, digest effect receipts and matching chat/message verification. Link previews are disabled. Any uncertain Telegram send blocks subsequent automatic sends until external evidence resolves it. Do not clear that state based on report publication success.

Before enabling live publication, run the actual two-node workflow preview and inspect its source coverage, private report and publication receipt. Do not send a test Telegram message. Record first regular scheduled delivery separately with workflow/run identity, publication ID/version/digest, message ID, delivery checkpoint and completed effect receipt. Published editions remain readable with the Mac offline; fresh collection still requires the Mac.

When provider conversation bodies are truncated or exceed the decision bound, no reply action is inferred. A bounded excerpt of the two latest visible messages may still be summarized in German, explicitly labelled partial. The text model cannot change that fixed non-action disposition.
