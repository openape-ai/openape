# Generic Reports migration — issue 1401

Approved plan: https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3KTXVW1069NJZYPCNXNSTEA

Status: production implementation and Pod activation verified. npm registry publication
of CLI 0.3.0 awaits renewed owner login (401); it is not claimed complete.
Implementation PR 166 merged as `e40ae6ea`; version/release PR 167 as `983583f8`.
The acceptance branch is `feature/issue-1401-reports-acceptance`.
The adjacent JSON records the supported installed-Pod inventory, hashes, resource
epochs and schedule state captured before changes. Do not replay those snapshots.

## Producer decisions

| Producer | Source / format | Decision / category | Identity and state | Verification / rollback |
| --- | --- | --- | --- | --- |
| IURIO PR monitor | Downloads/IURIO-PR-monitor/pod-script.mjs; installed `ee652c30`; schema-1 checkpoint, Telegram text | Migrate to client-authored German HTML/CSS, PR Updates; canonical recipe in apps/openape-pods/examples/iurio-pr-monitor.mjs | Dedicated new publisher and separate live/preview series; retain baseline, pending delivery IDs, Azure/Telegram assignments, 900-second schedule rev 2 | Receipt-before-send, no-change silence, preview without send; actual no-send preview and first regular notification accepted; see live receipt. Reconcile effects before reverting script; never restore baseline |
| Morning sender | calendar-briefing/pod-script.mjs; installed `ce3ac5cb`; structured briefing/v1 | Compatible Briefings adapter; daily uniqueness and historical rendering retained | Existing dedicated publisher, live/preview series, checkpoint and disabled standalone schedule | Existing adapter suites and actual four-node live-source preview pass, zero Telegram POSTs; temporary preview series variable restored to its original value |
| Morning editorial | installed `c3836035`; morning-editorial/v1 | Compatible client-owned German content through briefing adapter; Briefings | No provider, publication or send capability; workflow rev 7 remains owner | Validate installed source hash and existing workflow contract; no script rollback needed |
| Morning mail review | installed `513896ca`; morning-mail-evidence/v1 | Unaffected upstream evidence | Preserve 60-second approval polling and pending grants | Inventory/source inspection; never retry archive effects for report verification |
| Morning calendar/issues source | installed `c0d4b7c6`; morning-sources/v1 | Unaffected upstream evidence | Existing scoped reads, no own schedule | Inventory/source inspection |
| Mail-Kurzbericht | installed `9a3d59ec`; direct Telegram | Unaffected, no Reports endpoint | Disabled schedule and one blocked input retained | Source/resource inventory; no migration or recovery |
| IURIO Task monitor | installed `8cb14586`; direct Telegram | Unaffected | Existing 300-second schedule | Source/resource inventory |
| Daily action website | installed `37a31b48`; local HTML output | Unaffected | Remains paused; disabled 08:00 schedule | Source/resource inventory |
| zaz Service-Agent (and archived test) | installed `3cdc600c` / `9c2d27d3`; service task replies | Unaffected | Existing blocked permission-service request retained | Source/resource inventory; no recovery |
| Timing test Pods | installed `b9a849f8`; no-op | Unaffected | Enabled 900-second and separate disabled 900-second schedules retained | Source/resource inventory |
| Archived Mail-Wissen, Mail-Alarm, Rechnungs-Emails, Test | no active script | Unaffected | Archived state and assignments retained | Supported inventory; no activation |
| ape-testruns upload | packages/ape-testruns; testrun.json plus images | Compatible shared-test adapter, Test Runs | Existing SP audience and uploader ACL; old slugs/versions preserved | Existing CLI roundtrip and real five-screenshot evidence upload pass; historical links remain shared |
| CLI publish | packages/ape-testruns; document/v1 JSON | New private client document; optional arbitrary category | Owner login or explicitly bound series publisher | Built merged CLI, API and browser verification pass; npm publication awaits login; disable new publishing without deleting reports |
| E2E evidence generator | scripts/e2e-manifest.mjs | Compatible testrun.json, Test Runs | No new schedule or publishing credential | Existing manifest/tooling tests; uses unchanged upload adapter |
| iOS evidence exporter | apps/openape-pods-ios/UITests/report.mjs | Compatible testrun.json, Test Runs | Manual existing workflow; no iOS CI changes | Format/source compatibility; no new native iOS run claimed |
| Git layout evidence | apps/openape-git/e2e/issues.layout.test.ts | Compatible testrun.json, Test Runs | Existing synthetic fixture | Format/source compatibility; unrelated Git suite not rerun solely for this migration |
| Testrun/PR CLI and proof E2E fixtures | apps/openape-testrun/e2e and apps/openape-pr/e2e | Compatible existing shared-test API | Disposable fixture identities | Relevant Testrun suite; existing routes remain |
| Guide capture | apps/openape-testrun/scripts/capture-guide.ts | Compatible shared test fixture | Existing synthetic guide capture | Relevant rendering suite; no unrelated guide regeneration |

The compatible briefing adapter is deliberately retained under the owner's explicit
migration-or-proven-compatibility scope. Its historical structured layout remains
available; it does not constrain the generic platform or new clients. The new PR
client owns its presentation. Plans remains unchanged.

## Migration and rollback contract

The new document table is additive. Generic publications have independent private
run rows with `report_type=document`; old privacy-safe builds reject that type before
rendering or asset access. Existing runs, archives, assets, daily receipts and series
bindings are not rewritten. Original request and sanitized artifact hashes are distinct.
`NUXT_DOCUMENT_PUBLISHING_ENABLED=false` disables new generic publication/preview while
retaining readable persisted documents and all compatibility adapters.

Before rollout: capture a consistent protected backup; rehearse migration twice and
compare every legacy row; test the intended rollback image against migrated private
and shared fixtures. Never restore a pre-rollout database over new publications.
Minimum historical privacy baseline remains `prod-183395e4`.

## Recorded checks

- Frozen installation and project doctor pass on the dedicated checkout.
- Initial full lint/typecheck and Reports build pass; Reports unit suite: 57 passed.
- Full lint/typecheck and Reports/Pods builds pass. Reports: 57 unit tests, 16 authenticated HTTP/CLI/browser tests and nine layout/component tests pass; Pods: 629 tests; CLI: four tests. Desktop/mobile German/English/category screenshots were personally inspected. Permanent tests protect publication, privacy, sanitization and delivery recovery contracts.
- Protected production backup: Chatty `/home/openape/backups/generic-reports-2026-09-28/before-generic-documents.db`, SHA256 `ae39604e239e2f0476f998b026120085c2f5fa42ef1b39c5bb69d82f50bde4b0`. Repeated migration preserves every legacy row; see the adjacent migration receipt.
- Rollback image `prod-7bab2ba6` was run without network access against the migrated copy: existing shared test API 200, private briefing 401/private-no-store, new private document metadata/version/assets/document 404 and no content disclosure. Retain new rows on rollback.
- Healthy tested-image deployment `prod-e40ae6ea`, previous `prod-7bab2ba6`; clean merged-main `pnpm check:ci` passed. Both aliases pass owner/anonymous access, replay 200/conflicting bytes 409, artifact digest and CSP checks.
- Both compatible upload and private generic Test Runs evidence are published with five inspected screenshots and verified category discovery. See `generic-reports-live-receipt.json`.
- Actual PR preview has zero Telegram requests. The first regular PR update completed with one confirmed Telegram notification after Reports receipt lookup. Active script `15808385`, existing enabled 900-second schedule revision 2.
- Morning four-node preview completed with zero Telegram POSTs, unchanged source hashes and restored standard preview variable. Existing daily 07:00 workflow revision 7 and mail approval polling remain unchanged.
- Production post-deployment comparison preserves all original 289 runs, 169 versions, 717 assets, three series and four daily publication rows byte-for-byte; SQLite quick_check is ok.
- CLI 0.3.0 version is merged; scoped release dry-run selects only this package and preserves six unrelated pending changesets. Registry publication is blocked by expired npm login; owner renewal requested.
- Pre-rollout inventory: healthy `prod-7bab2ba6`, 286 shared tests, three private briefing
  series, 717 assets (716 PNG, one JPEG), SQLite quick_check `ok`.
- Verified legacy asset boundary: request MIME was stored/served verbatim. The change
  derives image MIME from raster signatures and applies nosniff/sandbox to reads,
  including historical bytes. Unsupported historical data downloads as an attachment.

## Guidance activation

Authoritative AGENTS/visual-verification/vault guidance was updated only after real
publication, screenshot display and Test Runs category discovery were verified. Existing
shared links and requested/needed local exports remain supported. Generic CLI guidance
requires version 0.3.0 and records the pending npm release. Shared ~/.claude changes
are committed/pushed separately; generated Codex memories remain untouched.
