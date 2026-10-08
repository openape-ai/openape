# Active work

## Pods Inbox app badge — issue 1452

- Issue: https://repos.openape.ai/patrick/monorepo/issues/1452. Worktree `openape-monorepo.worktrees/pods-inbox-badge`, branch `feature/issue-1452-pods-inbox-badge`, base `dfa801791e31ff2567e57d6d576c2af0e818d401`.
- The app icon counts open, unarchived decisions plus unread, unarchived messages. Foreground updates wait for a complete successful sync; reading, archiving and resolved decisions update the count, and sign-out/revocation clears it. Push handling refreshes the account total from an authenticated private/no-store endpoint while still displaying its notification.
- Verification: full root lint and typecheck; relay production build; 85 relay unit/component tests; real DDISA/browser inbox acceptance with Badging API interception (6 before reading/resolution, 3 after, 0 on revocation), server count and anonymous 401. The two inspected mobile screenshots show the matching 4+2 and 2+1 tab counts.
- Permanent tests protect the new counting, account isolation, pagination, logout and visible-push contracts. No dependency, database migration or test command changes.
- Next: PR review and rollout. Real iOS home-screen rendering and APNs delivery remain unverified; the Inbox M5 push sender/subscription UI is separate pending work in issue 1446. Badge refresh on push does not introduce silent notifications.

## Pods mail network asks the same choice twice — issue 1451

- Issue: https://repos.openape.ai/patrick/monorepo/issues/1451. Owner correction October 8: the problem is the repeated "newsletter?" choice for the same mail; the final IdP approval stays.
- Cause (read-only DB copy, October 8): the Intake versioned mails by Outlook `changeKey`, so a read/flagged mail became case revision 2 and reached `uncertain-review` again; the Decisions tab shows the newest revision, and answering it left the older question open.
- Plan revision 3 (owner approved revision 2 with "Go"): https://report.openape.ai/d/01M4BXR6KG3WD5M1GM6CPRQ9N7.
- M1 (Intake content version + bounded seen digests) is live on the installed mail network since 08:46:39 (script `30c13820`, definition version 5). M2 (a choice closes older waiting revisions of the case, `choice-superseded` trace) is on PR 307.
- Worktree `openape-monorepo.worktrees/issue-1451`, branch `feature/issue-1451-owner-chosen-newsletters`. Checks: Pods 1,343 tests, root lint/typecheck.
- Next: merge PR 307, signed desktop build and installation with paired backup; observe the Intake runs.

## Pods fixture tests never wait for a keychain dialog — issue 1450

- Issue: https://repos.openape.ai/patrick/monorepo/issues/1450. Owner rule October 7: every automated check runs without a person; `test:distribution --signed-local` for `c24af0e3` waited on a SecurityAgent keychain prompt.
- Worktree `.claude/worktrees/issue-1450-pods-keychain-78e628`, branch `bugfix/issue-1450-pods-fixture-keychain`, PR 308 (https://repos.openape.ai/patrick/monorepo/pulls/308), base `930a8ee5`. Evidence: https://report.openape.ai/d/01M4BY5ENTTV3KCK3S33MDHN5Q.
- Fixture launches with `NODE_ENV=test` append Chromium's `use-mock-keychain`; `OPENAPE_PODS_TEST_REAL_KEYCHAIN=1` opts `credentials.test.ts` into the login keychain. `e2e/fixtures/keychain.ts` stops the app as soon as a SecurityAgent window is on screen (`credentials`, `programs`, `test:distribution`).
- Cause detail: local fixture builds are only linker-signed and share one cdhash, which the existing "OpenApe Pods Fixture Safe Storage" item trusts; only newly signed builds (Developer ID, re-signed) prompt.
- Checks: Pods 1,340 unit tests (new main-process contract with counter-proof), root lint/typecheck, `credentials` E2E on a re-signed build (mock passes without dialog; opt-in fails after 2 s with the guard message), unsigned `test:distribution` passed. `programs` E2E still fails at stale navigation after the redesign (pre-existing, keychain part passed).
- Next: owner review and merge; signed-local `test:distribution` with the next signed build.

## Pods mobile inbox PWA — issue 1446

- Issue: https://repos.openape.ai/patrick/monorepo/issues/1446; approved plan revision 2, publication v8: https://report.openape.ai/d/01M4B5Q1Q0W6C97A4ZXTFZ5WJR.
- Live: M1–M4 as relay `prod-76ffae69` (PR 303, October 7); desktop `3c08d3c7` (schema 41). The owner made three real network decisions from the phone (all `applied`), which completes the M2 functional path; formal iPhone acceptance of M4 is open.
- Live since October 7 ~20:35: card decisions (PR 304) with relay `prod-c24af0e3`. Current branch `feature/issue-1446-inbox-card-sender` (owner feedback 20:43): the card shows the sender first (only when exactly one sender line exists), classification hints instead of the raw field list, smaller type, and a status-bar backdrop. Owner report 20:50 (cards jumped, a mis-tap could not be undone): every answer waits 5 s with Undo; the list freezes once touched or scrolled, new decisions wait behind a floating hint, answered cards keep their height; the update banner floats above the tab bar. The desktop now escapes line breaks in decision facts (active with the next desktop release).
- Checks: relay 76 and Pods 1,339 unit/component tests, root lint/typecheck, browser acceptance `e2e/inbox-app.test.ts` with mail-choice card, undo and exact card positions.
- Next: merge and relay deploy after owner go; M5 push. Handoff: [pods-inbox-m4-handoff.md](pods-inbox-m4-handoff.md).

## Pods gate batches collect before freezing — issue 1449

- Issue: https://repos.openape.ai/patrick/monorepo/issues/1449. Owner observation October 7: every answered network choice produced its own one-item IdP approval batch. Owner decision: a quiet window (about 2 minutes without new input, at most 10 minutes) instead of growing sealed batches.
- Checkout `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo.worktrees/pods-gate-quiet-window-1449`, branch `bugfix/issue-1449-gate-quiet-window` (base `76ffae69`).
- Change: `NetworkGates.prepare` freezes only after the quiet window, the maximum age or a full batch; synthetic fixtures (unit fixture, Electron fixture worker via `PODS_FIXTURE_GATE_COLLECT`) keep immediate freezing.
- Checks: Pods 1,339 unit tests, lint, typecheck, build, Electron `e2e/network-gates.test.ts` (2/2).
- Next: merge after owner go, signed desktop build and installation with backup (no relay or schema change).

## Pods network member script updates — issue 1445

- Issue: https://repos.openape.ai/patrick/monorepo/issues/1445; approved plan: https://report.openape.ai/d/01M4B5W5S3S1DDBQF9PDFED194 (revision 1, owner approval October 7).
- Worktree `openape-monorepo.worktrees/member-scripts-1445`, branch `feature/issue-1445-network-member-scripts`, base `e89449e2`.
- MCP may inspect, draft and validate network member Pods; `networks updateMemberScript` activates a validated script with unchanged contract, capabilities, effects and dependency lock, re-pins only that member within the current network revision and records `member-script-updated`; `networks replayFailed` restarts blocked runs of that member that failed under an earlier script without effect attempts, workflow calls or approved inputs. The Pod detail shows the latest assistant script update.
- Checks: Pods 1,312 unit/component tests, 53 browser layout tests, lint and typecheck clean. Local packaged E2E timed out with the installed app running; CI decides.
- Next: PR, CI, merge, signed installation, Newsletter batch repair.

## Pods owner decisions lost silently — issue 1444

- Issue: https://repos.openape.ai/patrick/monorepo/issues/1444. Found on the installed app on October 7: choices after the first few were never saved, while the inbox showed them as decided.
- Worktree `openape-monorepo.worktrees/grant-batches`, branch `bugfix/issue-1444-pods-decisions-saving`, base `d58174bd`.
- Desktop owner actions run one at a time and resubmit `workspace_busy` / `workspace_revision_conflict` refusals; the inbox shows "saving" until the case leaves the list and returns refused cases with their reason; action errors stay visible; superseded batches without inputs to review are hidden.
- Checks: Pods 1,305 unit/component tests, 53 layout tests, lint and typecheck clean.
- Next: PR, CI, merge, signed installation.

## Grant batches — issue 1442

- Issue: https://repos.openape.ai/patrick/monorepo/issues/1442; approved plan: https://report.openape.ai/d/01M4AQCZFG6NXWF4NYS8DWKGV6 (revision 1, owner approval October 7). Protocol PR 3 merged as `ac95a447`.
- Worktree `openape-monorepo.worktrees/grant-batches`, branch `feature/issue-1442-grant-batches`, PR 289; base `31250d69`, merged with main `4687ed4d`.
- IdP: optional `request.batch` with uniform once members, `batch` list filter, `openape_grant_batch_supported`, batch approval view and grouped pending list, one notification per batch. Pods: one once-grant per gate item for network gates, workflow gates and the mail archive; schema 40.
- Evidence: https://report.openape.ai/d/01M4AVZ745E30GG2KF5TSA5R2W (v2): unit/layout suites, local acceptance against a running IdP with the real Pods grant authority; the native SIGKILL locator failure was pre-existing and is fixed by issue 1443.
- Next: merge, IdP deployment, signed Pods installation, one real owner-decided batch.

## Pods network-gates native E2E label — issue 1443

- Issue: https://repos.openape.ai/patrick/monorepo/issues/1443. Worktree `.claude/worktrees/adoring-brahmagupta-463b2a`, branch `bugfix/issue-1443-network-gates-list-label`, base `6bd4c0d0`.
- The Automations map draws Pod names on a canvas, so the reopened-app wait now uses the List view's `Gate consumer` cell. Functional assertions are unchanged.
- Verification: `pnpm build && pnpm package:mac && npx vitest run --config vitest.electron.config.ts e2e/network-gates.test.ts` on an unlocked Mac, 2/2 passed; crash screenshot inspected.
- Next: exact-source CI, native review and merge.

## Bilingual Plans — issue 1440

- Issue: https://repos.openape.ai/patrick/monorepo/issues/1440; owner-requested implementation plan: https://report.openape.ai/d/01M4AR4BA9AACFE1MCCPPEP2MZ?v=1.
- Worktree `issue-1439-report-contract` reused without touching parallel work; branch `feature/issue-1440-bilingual-plans`, base `6c0d8e222e87e510ad2719eb2e15d9dfe1947cd9`.
- Additive plan/2 summary/problem/translations; exact source matching and coverage guards; German/English/both offline template switch; localized labels, shared original evidence and approval; top TL;DR and responsive four-stage overview.
- Verification: existing unit suite plus retained language/evidence contracts; actual Chrome offline/no-JavaScript, keyboard, light/dark, narrow/wide and selected/both print checks. Independent Claude Opus 5.5 review findings corrected; final focused review found no code blockers. Root lint/typecheck, CLI build and 49 tests pass; 12 browser combinations and the six-page bilingual PDF checked. PR: https://repos.openape.ai/patrick/monorepo/pulls/288. Next: final source CI, merge, local install and shared guidance activation; publish final evidence. Public npm release retains its existing authentication limitation.

## Batch grant approver policy — issue 1441

- Issue: https://repos.openape.ai/patrick/monorepo/issues/1441. Security fix found by code reading on main `6c0d8e22`; not exploited.
- Worktree `.claude/worktrees/gallant-gould-bff3b0`, branch `bugfix/issue-1441-batch-grant-authz`, base `6c0d8e22`.
- `POST /api/grants/batch` now applies the same shared per-action policy (`grant-authority.ts`) as the single approve/deny/revoke endpoints; refused items return per-item 403.
- Validation: root lint (55 tasks) and typecheck (78 tasks) pass; 650 nuxt-auth-idp tests pass. The new batch tests fail against the previous handler (agent self-approve succeeded).
- Next: exact-source external CI, native review and merge, IdP deployment, then the production audit of decided grants described in the PR.

## Report data contract — issue 1439

- Issue: https://repos.openape.ai/patrick/monorepo/issues/1439; approved proposal: https://report.openape.ai/d/01M4AGFRAXT93Y305ZEJJZQ023?v=1. Owner approved implementation on October 7; progress edition 2 records that decision.
- Worktree `issue-1439-report-contract`, branch `bugfix/issue-1439-report-review`, base `cd02ad257e36c2cb3d20f567b7c9503469c7a647`.
- Versioned schemas, generated types, semantic validation, evidence integrity, reviewed layouts and rendering receipts implemented. Behavioral tests retain regression coverage for misleading status/approval claims and evidence loss.
- Validation: root lint 55 tasks, root typecheck 78 tasks, CLI build and 43 tests pass. Eight historical/proposed examples pass schema and semantic validation; 375/390/1440 px light/dark, keyboard/anchor behavior, embedded galleries and actual PDF output are verified. Command duration/timestamp consistency has dedicated regression coverage. Evidence: https://report.openape.ai/d/01M4AHX7XN3877QBANQ30VA3ED?v=1. PR 285 merged and 0.6.0 was installed. Supplemental Claude Opus 5.5 review found replacement-character log rejection, publication label mismatches and spacing gaps. This follow-up fixes them and versions 0.6.1 through isolated Changesets, preserving unrelated pending changesets. Next: final follow-up tests, exact-source CI, native review, merge and installation. npm publication depends on the existing registry login; no npm success is claimed.

## Pods desktop IdP decision links — issue 1438

- Issue: https://repos.openape.ai/patrick/monorepo/issues/1438
- Worktree: `openape-monorepo.worktrees/issue-1438-pods-idp-links`; branch `bugfix/issue-1438-pods-idp-links`; base `dcf3d5cd0339b589cac140e417e8f679193eb69f`.
- Desktop batch actions use the existing native network/workflow `gateOpen` commands; browser links keep their normal target. Electron navigation restrictions remain intact.
- Verification: full `pnpm lint` (55 tasks), `pnpm typecheck` (78 tasks), Pods build and `pnpm --filter @openape/pods test:fast` pass (1,297 unit/component and 52 browser tests). Permanent component cases cover both batch types and hosts because attribute-only assertions missed the broken desktop behavior.
- Next: native PR and exact-source external CI, then signed desktop delivery and installed acceptance. No installed-fix claim yet.

## Report templates and CLI migration — issue 1437

- Issue: https://repos.openape.ai/patrick/monorepo/issues/1437; approved design: https://report.openape.ai/d/01M49MYRK3TBJ850CR0S0GYGQW; implementation plan: https://report.openape.ai/d/01M49KKGQCJP11RP8XQQT75835.
- Owner approved implementation on October 7. Worktree `issue-1437-report-templates`, branch `feature/issue-1437-report-templates`, base `6a8ad37b329e95703d01e04cc5193604f3a0b32f`.
- Implemented offline Plan/Test Run renderer, embedded raster evidence, input validation, approval separation, native Reports team CLI/API, deprecation notices and producer/guidance migration. Legacy read/write compatibility remains until its conditional retirement gate is met.
- Checks so far: root lint 55 tasks, typecheck 78 tasks, Reports build, 15 CLI/renderer tests, 79 Reports unit tests, four isolated real-auth CLI/compatibility journeys. Desktop/mobile light/dark template screenshots, expanded passing state and print-CSS harness inspected. Claude Code Opus 5.5 independently reviewed code and UI twice; confirmed findings corrected, including exact Markdown evidence, team list compatibility and deletion policy. Final-head checks precede merge.
- [Producer inventory and observation rules](../operations/report-templates.md): retrospective server access logs are unavailable; remaining project callers and eleven unavailable network-member source reads prevent a complete inventory. No seven-day quiet period is claimed.
- Next: finish review and exact-source gates, release/install the CLI and deploy the Reports team/observation routes; record receipts on the PR/issue after merge. Keep retirement pending with its evidence requirements.

## Reports redesign — issue 1433

- Issue: https://repos.openape.ai/patrick/monorepo/issues/1433; plan: https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M48ZTNG1PGJZ65AYX4QDHNHN (owner-approved October 6, 2026); approved prototype copy: https://report.openape.ai/d/01M48ZPPY22PGEDKFX64H6YRKD.
- Worktree `openape-monorepo.worktrees/issue-1433-reports-redesign`, branch `feature/issue-1433-reports-redesign`, base `c98a018b`. Tested source `68b44e9f`.
- Delivered M1–M6: tokens, one merged library over `GET /api/library`, full-page reading view with the trust gate on the sealed frame and a Details drawer, Recently removed with a private restore dialog, browser editor removed (`/d/ID/edit` → 301 `/d/ID`).
- Evidence: https://report.openape.ai/d/01M492M570VKK81C4HX0GJB5EY (Test Runs): repository lint/typecheck, Reports build, affected unit contract (79 Reports tests), layout 13/13, serial E2E 37/37, 68 personally inspected screenshots.
- Follow-up: publisher type for HTML reports, https://repos.openape.ai/patrick/monorepo/issues/1434.
- Next: owner review of the native PR. No deployment without explicit owner approval.

## Single-HTML Reports and Plans consolidation — issue 1429

- Plan: https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M486HDNVQDQED9S45AJTJNF3
- Issue: https://repos.openape.ai/patrick/monorepo/issues/1429
- Owner explicitly approved end-to-end implementation in the fresh session on October 6, 2026. Approval is recorded in the synchronized plan, independently of status.
- Worktree: `openape-monorepo.worktrees/issue-1429-reports`; implementation branch `feature/issue-1429-generic-report-documents`, release branch `feature/issue-1429-reports-release`; base `64b8d98ff69390636e640637aa08a51157504662`.
- M1 evidence: https://report.openape.ai/r/D8KMoQ-Z2JsUNwQ_EcJGn2j5 (Test Runs). Owner accepted publisher-trusted active HTML with no absolute network-egress promise; Safari remote automation is disabled; native Safari prototype interaction and rendering were personally inspected without changing settings. Complete service census: 154 Plans (including 2 deleted), 2 teams/2 memberships, no invitations; Reports inventory is retained privately.
- Owner also requires versions for legacy Plans writes; old unversioned clients receive an upgrade response.
- M2–M5 implementation: HTML store/policies/capabilities, CLI, collection/source editor, Plans teams/invites/source adapter and compiled migration/reverse operator. Full root lint (55 tasks), typecheck (78 tasks), Reports build, 74 Reports unit tests, 31 serial Reports E2E tests, 12 layout tests, 27 Plans tests and 11 CLI tests pass. Eight current authenticated Chrome screenshots were personally inspected. Packed CLI installs and previews outside the workspace. The built-server E2E suite denies all routes and health until current backup policies reconcile, including missing/invalid journals.
- Full-copy operator rehearsal imported 154 Plans, repeated with zero additions, reconciled source/metadata/roles, preserved a newer source edit during reverse mapping and denied a stale reverse apply. Protected source snapshots are not published. This was the pre-cutover rehearsal; protected source snapshots and producer state were preserved.
- Implementation: PR 259 merged as `6fbec6046949fd1a230423982f59264566a39e6e`; source `443fb1d5a4829572c201d1d440798c132b423dc9`, reviewed against `72ec0889dfcc637e91cd6ba4b87c4bd05df4ff31`. Review fixed stale file/stdin replacement in ape-plans with mandatory original `--expected-version`; the three CLI/legacy-host E2E journeys pass after the fix. Evidence: https://report.openape.ai/r/s6YXda39bZVdBYS1-tJFzeuV (eight inspected screenshots, verified Test Runs discovery). Linux image operator repeats all 154 rows and reverse apply successfully.
- Release PR 262 merged as `5965c083a30eb26b42dd6d28af6aeb97e332b94d`. npm accepted Reports CLI 0.4.0 from that SHA and Plans CLI 1.0.5 from current main `5ecd90330370beb563b66d020f72ea69f7a36df9`; Both registry packages are installed; all 18 Reports subcommand help screens and existing authentication pass. Installed acceptance found the historical hard-coded ape-plans version display (1.0.1 despite package 1.0.5); the follow-up patch reads its package version. Full clean-main `pnpm check:ci` and external main CI5455 pass on 5ecd9033. The intervening Troop merge is preserved; its predecessor CI was cancelled, not a test failure.
- Existing Reports copy rehearsal preserves all 1,794 original rows by digest while importing 154 Plans. The actual previous production image keeps old shared links readable, displays an inspected unavailable state for migrated Plans, denies their content API and leaves all migrated HTML/version bytes unchanged.
- Production checkpoint: both services now run tested `prod-f1e6e1a7`. All 154 frozen Plans reconcile exactly; repeated import adds zero. Source digest `04125f08b2a54763ef04b03555783ca4ab10e86f67240c4c340394791b5f0168`; protected backups remain on Chatty under `/home/openape/migrations/reports-1429-20261006`. Reports is the sole writer, both freezes are off and single-HTML publishing is enabled. Content-origin DNS/router rollback and credential/API isolation pass.
- CLI display patch PR 263 merged as `cf61e9fcaf55043ced64cc46f8d6b50da3e7a7a6`; actual registry Plans 1.0.6 is installed and reports that version. Existing auth and other global direct dependencies are preserved. Actual production publication/history/CAS/idempotency/access, real-clock expiry without renewal, explicit private restoration and legacy source editing pass, with 15 denial checks.
- Retirement PR 264 merged as `f1e6e1a7ce267f3ddec79621e3d621e884cddcba`; exact source `9142d8521e9936bf792aa861a53387fe572887da`, final reviewed target `64eb34385356ee6e1792d8bd8d8dcc6b46175103`, source CI5463 passed. Full clean-main local `pnpm check:ci` passed before the tested-image deployment. Both services are healthy on `prod-f1e6e1a7`, previously `prod-5ecd9033`. Plans no longer contains the legacy database module or holds an open plans.db descriptor; its backup is retained. The unrelated subsequent Pods main merge is preserved and was not deployed by this task.
- Full lint/typecheck/build, 27 Plans and 74 Reports unit tests, 12 layout, three CLI/adapter E2E and three existing documentation journeys pass. Both packaging paths pass. Actual deployed checks preserve `/plans/new`, reject missing/stale source versions with 428/409 and retain content. Corrected light/dark narrow metadata and active HTML were personally inspected. A blank iframe screenshot from a reused theme context was replaced by a verified fresh-context capture; no blank image is presented as passing evidence.
- Actual private single-file production evidence, version 3: https://report.openape.ai/d/01M48K08CJ2SYKSDBFV947ETA6. Ten embedded screenshots decode under normal owner authentication; anonymous API access returns 404. Optional installed renderer editions, category/tag intersection, all three usage journeys and post-migration legacy screenshot upload pass. Shared agent guidance is committed/pushed as `b137a2e`; authoritative vault notes are synchronized.
- Current documentation branch: `feature/issue-1429-delivery-receipt`. External full-main CI5469 reported a Pods test failure after the successful local deployment gate. The newer canonical main `82d39a3a6e5870d6b9a8037ee17fd47711666729` passed the complete external CI5471 before this receipt merge; the earlier failure is retained in the record. No Reports production failure was observed.
- Remaining acceptance: observe the first regular post-cutover producer publication. The IURIO PR monitor currently has upstream Azure read gaps; the October 6 morning edition predates cutover. Next morning workflow: October 7 at 07:00 Europe/Vienna. Thread follow-up `reports-1429-regul-re-ver-ffentlichung-pr-fen` runs at 07:15, read-only toward producers. All 38 Pod configurations/workflows and producer hashes, credentials and schedules remain unchanged; Linde stays paused. Never force a run or notification for acceptance. Keep issue 1429 open and plan active until actual regular delivery and all acceptance are recorded.


## Descriptions through the central workspace — issue 1426

[Issue1426](https://repos.openape.ai/patrick/monorepo/issues/1426), closed. [PR246](https://repos.openape.ai/patrick/monorepo/pulls/246) merged as `42541063df04c2977e8b0f94e2861531b5b54c67`; exact-source and full-main checks passed; 1,358 Pods tests and 35 relay tests passed.

`details describe` is accepted for network member Pods and the workspace command `describeCollection` for networks and workflows, through MCP and the central workspace. Every other change to a network member still requires desktop review. The MCP reference in `apps/openape-pods/src/contracts/codex.ts` documents both.

Relay `prod-42541063` was deployed first on October 5 (previous `prod-f452c0ae`), then the signed-local desktop 0.1.2 from clean `42541063`, schema 38 unchanged, installed at 21:23 CEST. Notarization, stapling, Gatekeeper and mounted synthetic acceptance passed (DMG SHA256 `fc11484e70e842920a1e67f64f81f17e38f93e38e211a45528771ad913dd50e2`); the installed archive equals the built one and all counts are unchanged. The round trip was verified on the installed desktop: 22 network member descriptions and 5 network and workflow descriptions were applied and equal the prepared texts; all 38 Pods are described and the Delta Mind network stays at revision 3. Paired byte-verified rollback: `/Users/patrickhofmann/Library/Application Support/OpenApe Pods Rollback/20261005-describe-central-1426`. The section below describes the two releases before this one.

## Pods visibility — issues 1424 and 1425

[Issue1424](https://repos.openape.ai/patrick/monorepo/issues/1424) and [issue1425](https://repos.openape.ai/patrick/monorepo/issues/1425), both closed; plans [A](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M4631YCZMYKBKW7F3AQ96D2Z) and [B](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M46759EEZEZA4A9ZQNEDG0JD). Checkout: `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo.worktrees/pods-visibility`.

The Pod inventory and standalone overview cards show a one-line purpose per Pod, the Pod overview states the last run's own summary, network choice cards show readable fields with the raw payload under technical details, and the description field is labelled as an explanation. Networks and workflows have an owner-written description (local table `collection_descriptions`, schema 38) that the desktop owner edits on the detail page; overview cards show its summary. Both travel in the workspace state, not in a published table or definition. Editing network and workflow descriptions from the browser or through MCP is not available.

[PR242](https://repos.openape.ai/patrick/monorepo/pulls/242) merged as `e0a15434e7ad77c4ab44a882843d6ea75e14ea4b` and [PR243](https://repos.openape.ai/patrick/monorepo/pulls/243) as `0c6bf3c3c36d1f44d1c3b90cb5073de32a1fb3f8`; exact-source CI5403/5404 and both full-main checks passed. Root lint/typecheck, app build, 1,357 Pods tests, 35 relay tests and five browser layout tests passed. Synthetic evidence: [package A](https://testrun.openape.ai/r/DWKW3tg0aqgc-Vb03zOto0uY), [package B](https://testrun.openape.ai/r/S3EXK34pXTB6V_lFng8kFsyI).

Signed-local 0.1.2 from clean `0c6bf3c3`, schema 38, is installed since October 5, 17:13 CEST. App and DMG notarization, stapling, Gatekeeper and mounted synthetic acceptance passed (296 packages; DMG SHA256 `fb00d3f1cb292cb54966f3a79778e7b2bfe43e807cd34ada14a454864a1a0153`). The installed archive equals the built one. After migration 38 Pods, 81 scripts, 70 resources, seven schedule definitions, one network with 11 members, five workflows, 86 credential files and the runtime identity are unchanged; the desktop is online and the Delta Mind mail network active. Schedules stood still for about two minutes; the first scheduled runs on the new build completed. The first natural network Intake run `55b0d90c-c6ac-46fc-ab55-8c85781b6b07` completed at 17:19 CEST without error; the network stays at revision 3 with no scheduler or intake error.

Relay `prod-f452c0ae` was deployed from canonical main with owner approval on October 5, 20:31 CEST (previous tag `prod-062143d2`). The health gate passed, the served browser bundle carries the new interface, the desktop stayed online with all 38 Pods and scheduled runs continued. Before the deployment the earlier relay's contract code had been checked against the new workspace fields. Paired byte-verified rollback of the schema-37 app and profile: `/Users/patrickhofmann/Library/Application Support/OpenApe Pods Rollback/20261005-visibility-1424-1425`. Never open the schema-38 profile with the earlier build. Not verified: Electron E2E and a signed-in browser session on the deployed relay.

## Runtime identity recovery — issue 1408

[Issue1408](https://repos.openape.ai/patrick/monorepo/issues/1408). Checkout: `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo.worktrees/pods-standing-runtime`; branch `bugfix/issue-1408-preserve-runtime-identity`, base `0b11e01457fc3d85e5f657d090a3ca097a049dc0`.

A revoked session family now requests normal browser authentication using the existing runtime ID and keys. Returned owner, ID and generation must match before credentials or worker registration are replaced. Revoked devices, missing local registration, changed generations and terminal enrollment conflicts fail closed. Compatibility and recovery documentation records the relay-first preflight. Eight retained main-process regressions exercise the real RelayAuth/RelayStore and worker registration with synthetic transport/browser/keychain boundaries; the additional relay regression protects revocation, pairing and same-device enrollment. These permanent tests cover consequential workspace identity loss.

[PR240](https://repos.openape.ai/patrick/monorepo/pulls/240) merged as `6e398662bada39f6689e3018321f79232dd607cc`; exact-source CI5399 and full-main CI5400 passed. Root lint/typecheck, app build,1,323 Pods tests,35 relay tests and clean merged-main full unit checks passed. Signed-local0.1.2/schema37 is installed; App/DMG notarization, stapling, Gatekeeper and mounted synthetic acceptance passed. Actual desktop is online with unchanged runtime/owner/generation, configuration fingerprints, pairing and standing consent; both approval options remain checked. [Verified private Test Runs](https://report.openape.ai/r/m6X0ae-1o76w_4yxSVE3Ju6z) contains personally inspected installed screenshots, actual receipts and synthetic-boundary limits. Production login was not deliberately invalidated. Issue1408 is closed; no implementation or delivery step remains. Protected paired backup: `/Users/patrickhofmann/Library/Application Support/OpenApe Pods Rollback/20261005-runtime-identity-1408`.

Patrick separately authorized the Delta Mind mail network: revision3, eleven active members,900second Intake;13 real invocations, three pending owner choices and no mail writes. Nine verified completed Pods issues were closed. [Private activation/backlog Test Runs](https://report.openape.ai/r/kK52np16fhKsZGU_Kz_a_uAq). M14 observation and both human routes remain open under issue1417.

## Central execution recovery — issue 1423

[Issue1423](https://repos.openape.ai/patrick/monorepo/issues/1423), [approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M45PKJ4JQAX647R6ZND47A1J), [PR237](https://repos.openape.ai/patrick/monorepo/pulls/237). Checkout: `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo.worktrees/pods-standing-runtime`; delivery receipt branch `bugfix/issue-1423-delivery-receipt`.

PR237 merged as `062143d2e41aed0f3dad860a3898e94910fc1b73`; exact-source CI5393 and full main CI5394 passed. Signed-local desktop0.1.2/schema37 and relay `prod-062143d2` are delivered. Root lint/typecheck, app build, 1,315 Pods tests, six browser checks, full repository unit checks and mounted signed-DMG acceptance passed. App and DMG are notarized, stapled and Gatekeeper accepted. [Verified private Test Runs](https://report.openape.ai/r/ktucXlYdTYlspg_QajaQz9TD) includes installed screenshots and actual backend receipts.

IURIO Task monitor resumed its September30 shutdown automatically at12:33:16CEST, using the original accepted input and existing runtime/read grants. It reported12 real changes through its separate existing Telegram grant, with one completed HTTP receipt. Catch-up at12:33:41 and regular schedule at12:37:56 both completed with204 unchanged tasks and no additional message. There are zero blocked inputs and no approval wait. No manual retry, queue edit or script change was used.

All38 stored Pods,70 resources,81 scripts, seven schedule definitions,86 permanent credential IDs and exact assignment/network bindings remain. Standing consent was verified checked and byte-identical. Credential ciphertext refresh and temporary broker files are expected runtime activity, not byte-preservation claims. The eleven-member network stays paused at revision2. Protected paired backup: `/Users/patrickhofmann/Library/Application Support/OpenApe Pods Rollback/20261005-central-recovery-1423` (2,271 app entries,15,919 profile entries, all verified). The schema36 binary cannot read schema37; preserve newer effect receipts and rotating sessions during any separately assessed rollback.

Central recovery separates failed history from original-input backoff, exhausted-input isolation and concrete safety holds. Unknown external outcomes, unverified process domains, refused authority and changed bindings remain protected. Runtime permission never substitutes for action grants. No implementation or rollout step remains; the separate M14 network activation decision remains unchanged.

## Standing runtime approval — issue 1422

Owner-approved implementation: [issue1422](https://repos.openape.ai/patrick/monorepo/issues/1422),
[plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M45FMPAY4XDXY7FMVTB2F093).
Checkout: `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo.worktrees/pods-standing-runtime`,
branch `feature/issue-1422-standing-runtime`, base `d5cbc516`.

The explicit all-Pods option binds consent to the signed-in owner and registered
runtime, preserves the legacy local-MCP setting, and authorizes only exact
per-Pod runtime grants. A scope receipt rejects stale settings after an account
or runtime change. Decisions and preference changes are serialized. Existing
IdP grant management owns revocation; disabling automatic approvals does not
revoke issued grants. Action authorization and schedules are unchanged.

Retained regression tests protect consent migration, identity binding, refusal,
serialization, trusted IPC and independent controls. Full lint/typecheck and
app build pass. The full unit contract and inspected English/light and
German/dark settings screenshots are recorded in the PR/Test Runs receipt.
PR235 merged at `01c02b1c` with CI5389/5390 passing. A final retention audit
reproduced deletion of the last denied/revoked grant reference after 50 runs.
Follow-up `bugfix/issue-1422-retain-runtime-grants` pins the latest authorization
reference per Pod/permission/issuer/subject; all 68 data tests pass, including
three new permanent security regressions that failed before the fix. Next:
follow-up CI/merge, fresh signed-local delivery and installed acceptance.
Production standing approval remains an explicit owner decision.

## Service authorization recovery — issue 1421

A temporary HTTP failure while creating a runtime grant must use the existing
infrastructure backoff instead of permanently blocking accepted inputs. The
fix in `bugfix/issue-1421-service-recovery` classifies transient HTTP responses
for grant creation as well as reads/token requests. Transport ambiguity on
non-idempotent creation remains distinct. Denied/revoked decisions, unknown
delivery receipts, binding checks, and paused networks retain their guards.
Permanent regressions cover transient/refused creation responses and automatic
recovery that still waits for owner approval. Existing scheduling/recovery tests
cover durable retry, restart, pause, binding changes and effects.

The installed zaz Pod was recovered through the supported run recovery command
(receipt `a7a78d5e-3ed8-42fb-a32a-c9f62d50db17`, applied). Run
`4746910d-f80b-4eb3-8ea3-e3cde42b5ec2` completed a real queue read after its runtime
grant became approved: queue empty, no model call. Twelve blocked inputs were
released; completed effect history and the paused Delta Mind network remain.
Source base: `01fa0886fd3171ca55f44ce6187c38dd68835af5`. Checks and signed rollout
are recorded in the issue/PR and private Test Runs receipt before closure.

PR232 merged at `6e1bebf2` with source/main CI5383/5384 passing. During live
recovery the owner IdP independently returned `SQLITE_BUSY`; its local database
used DELETE journaling. A consistent backup and targeted restart restored real
grant requests and zaz queue reads. The follow-up in
`bugfix/issue-1421-idp-read-lock` enables WAL for local file databases at startup.
A retained real SQLite regression reproduces the old reader/writer lock and
verifies commits while another connection holds an older read snapshot. Root
lint/typecheck, IdP build and all 345 IdP tests pass. Remote database and owner
approval semantics are unchanged. Exact-source CI and a tested owner-IdP-only
deployment remain required; the Pods provider and paused mail network stay as-is.

PR233 merged at `b1283ad5` (CI5385/5386) and the tested owner IdP image was
deployed. Three actual grant status requests succeeded while a read transaction
remained open; all 48,477 pre-rollout grants were unchanged. Live notification
hooks nevertheless exposed a separate concurrent-writer failure: every pending
read started an expiry transaction, including empty sweeps. A real three-reader
regression reproduces this with WAL enabled. The follow-up shares an in-flight
expiry sweep across request stores using the same database and avoids a write
transaction when nothing expired. It retains atomic expiry/audit and owner
decisions. Signed desktop `6e1bebf2` is installed, with 15,510 backup files
verified and unchanged network/permissions/schedules. zaz has no blocked inputs;
the current script still requires its owner runtime grant.


## Bounded network MCP and local start correction — issue 1417

Accepted through [PR229](https://repos.openape.ai/patrick/monorepo/pulls/229),
merge `efc7f0a47aa0504451c145c19a7f1ef410842f1b` (CI5377/5378), and
[PR230](https://repos.openape.ai/patrick/monorepo/pulls/230), merge
`7ebbc8fb49fbb9b515cec21de37c558c5c9c1b10` (CI5379/5380). The signed-local
0.1.2+efc7f0a4 desktop is installed and verified with a paired rollback; the
unchanged prod-87020ce8 relay is compatible and healthy. Actual connected MCP
runtime/inventory/network commands work. Root lint/typecheck/build, 1,288 Pods
unit/component tests, five focused native checks, independent Opus 5.5 reviews,
clean merged-source checks and signed mounted acceptance passed.

Actual source acceptance exposed an Intake example configuration-descriptor bug.
The failed run had no provider calls, inputs or effects and remains retained after
desktop review. PR230 corrected value unwrapping and the established regression;
the existing paused Intake now uses definition3 in network revision2. Run
`abaf747d-a781-4c3c-921f-26bbdf0da223` completed eight assigned read-only calls,
read six sampled messages, emitted zero changed versions and advanced checkpoint2
with its initial baseline intact. Exact process-request replay admitted no duplicate.
All348 prior runs, eleven members, seven schedules and historical choices,
deliveries, rights/effects and registration are retained;350 runs include both tests.

[Verified private Test Runs](https://report.openape.ai/r/2ugGi6qLKLqsTxsxHmePhOOF)
contains actual installed receipts and four personally inspected screenshots.
The approved plan and issue1417 hold the current acceptance record. M14 activation,
new schedules/mail writes and full consumer/Jev quality acceptance remain separate;
a source sample with no new versions does not prove downstream processing quality.
Next review the pilot scope and intended schedule without replaying old history.

## Delta Mind persistent network correction — issue 1417

Accepted through [PR228](https://repos.openape.ai/patrick/monorepo/pulls/228),
merge `87020ce82604fe0d4dc9076fb3f3db32484dd5ee`; source/main CI5375/5376 green.
The signed-local desktop and compatible relay were deployed. The real provider
baseline completed without emissions, then the existing eleven instances were
converted atomically into paused network `b95f1f8a-5dc0-4e5a-973f-cb660509d75d`.
All prior identities, 347 historical runs, three old owner choices and three
pending legacy deliveries were retained; the baseline added one run. Restart
preserved the entire semantic snapshot. Intake has no schedule; M14 remains a
separate decision. [Private Test Runs evidence](https://report.openape.ai/r/K8H2FDUTYYlx_uWsrLUUCwac).
The bounded MCP follow-up above resolves the two access limitations found during
that real acceptance.


## Sharing M3/M4 — issue 1419

M2 is accepted (PR217 merge `eb53ed76433280ac20d286f3669d9bb23184debe`, main
CI5354). M3 is complete in four merged increments, each with source and full-main
CI green and a verified private Test Runs report:

- PR218 `d564a51212091564aa90d8fa96f19bdb438b0294` (CI5355/5356): bounded archive
  reader, schema-34 import journal, worker importer (inspect, stage, configure,
  commit, complete, cancel, recovery), inert-setup guards, backup/restore handling.
  [Report](https://report.openape.ai/r/FmyYudXSf0Lar7_HNQCdQ0cW)
- PR219 `1bb1cccaef753b2c4f212897762283bb60fcb0ab` (CI5357/5358): schema-35
  resource aliases, `context.aliases`, alias binding with declaration checks,
  derived setup state, exact-lock dependencies, validated `portableImport`
  worker/main route with identity provisioning.
  [Report](https://report.openape.ai/r/lAyf2v1IAFx4XZTLzZTHCNjB)
- PR220 `1317b2d75bfa492f76f106069d90363812e51fa8` (CI5359/5360): imported
  sequences and channel graphs created disabled, package-keyed handoff outputs.
  [Report](https://report.openape.ai/r/bpthqdy5WjopPCQPeoFlOGP5)
- PR222 `b2da208e210640ee3524601c4f14ad51636cb618` (CI5363/5364): deferred
  persistent networks, called workflows and mail policies created after member
  approval (`worker/sharing/compositions.ts`), owner-scoped collections, artifact
  scopes and permissions, archive retention until the last deferred composition.
  [Report](https://report.openape.ai/r/slPxAWGL667nDEtBlALFnXSR)

M4 adds the owner-facing desktop and browser flow (`SharingExport.vue`,
`SharingImport.vue`, one `sharing` IPC/central channel through
`worker/sharing/service.ts`; export is desktop-only). The archive never leaves
the desktop: the main process reads the chosen file once and refuses
renderer-supplied bytes. Evidence directories: `/tmp/openape-pods-sharing-m3/`,
`-m3b/`, `-m3c/`, `-m3d/`, `-m4/`. Contract and limitations:
[sharing inventory](../architecture/pods-portable-sharing.md).

M4 merged through PR223 (tested source `1bb146bb610d10fc93dd167151655fa4995c1526`,
merge `76078194f749c7d16fa9f025ffd4587de31a0495`, source CI5366 green;
[Report](https://report.openape.ai/r/9fWEcp_TgnI41mWEF8VJtYot)). Full-main CI5367
failed three seconds after start without a step log; the Forgejo API exposes no job
log or rerun for it, so the rerun is an owner web-UI action. Evidence:
`/tmp/openape-pods-sharing-m4/`.

Native acceptance items not covered by unit tests: an end-to-end run through the
installed app with a real package file, mail finalization, gates/joins format
versions, called channel graphs and actual runtime calls of imported
compositions. These belong to M13 together with the signed relay-first rollout.

## Network M12 — bounded feedback (issue 1417)

Accepted: PR224 merged reviewed source `5b56999960051f4a30d56afdddebdd1422e95742`
(final head `f94883c39f51dc8c1858a651cbd9a2b053393e30`) as
`a5a1c702e17552d69af3aa889b9dc4a5a295bd7b`; source run 5370 and main run 5372
green. Definition format version 4 `feedback` declarations, runtime hop and
transition identity (workflow-call results included), delayed deliveries, held
feedback with `feedback-review` trace and `discardFeedback` owner resolution,
portable documents at format 4; no schema change. Contract:
[network contracts](../architecture/pods-networks/contracts.md). The owner-approved
braces audit exception PR226 (`e41ac5ae…`) is recorded in
[dependency audit exceptions](../operations/dependency-audit-exceptions.md).
Evidence: `/tmp/openape-pods-networks-m12/` (temporary; the M12 Test Runs report is
not published yet).

CI incident (October 3–4): the Forgejo runner cache filled the runner host's root
volume (every job failed three seconds after start without a log) and Forgejo kept a
sticky queue write error after the volume was freed; the cache now lives on the data
volume, Forgejo was restarted by the owner, stale runs were re-triggered.

## Network M13 — acceptance and signed internal candidate (issue 1417)

Source: clean canonical main `a5a1c702`. The synthetic acceptance matrix is mapped to
retained cases in [acceptance matrix](../architecture/pods-networks/acceptance-matrix.md).
Relay-first rollout: the relay image carries the browser workspace (network views since
`93087f5f`, portable import since PR223), so `pnpm run deploy:image pods-relay` from
this source precedes the desktop installation; both are separately gated owner actions,
as are live conversion, schedule activation and external actions. The mounted-DMG
acceptance (`pnpm test:distribution --signed-local`) failed on every run in this
session (five of five) because `page.waitForFunction` does not await its async
predicate and reported the worker ready after ~24 ms while it was still starting
(ready after ~420 ms); it is a race that earlier releases won. The script now polls
the actual state. A signed-local candidate built from `a5a1c702` (version 0.1.1,
DMG SHA-256 `7a580643727d7dbd8f83546f9e1cb04997050cc1ca0262b50663ae98a0c30ee2`) passed
the corrected acceptance with the working-tree script. The delivered 0.1.2 candidate is
rebuilt from the merged M13 source and its acceptance is still pending.

## Sharing M2 — issue 1419

Owned snapshots, explicit assets, freshness-bound privacy review and complete
Pod/workflow/network export mapping are implemented. Root lint (54 tasks),
typecheck (77 tasks), Pods build, 1232 Pods units, 37 protocol tests and three
manual native dependency checks pass. The native test exports a validated script
with its actually prepared npm lock. Actual Opus reviews prompted and verified
boundary corrections; original findings and dispositions are retained. The closure
review identified excessive repeated common-value findings; the corrected scanner
uses one word-aware finding per file/value and excludes generated metadata only
from known-value checks. Scope inputs are independent of other roles. A synthetic
32 MiB scan took49 ms locally, with2.5 ms maximum timer delay; UI responsiveness
still belongs to M4. Final
native PR/CI/report acceptance remains pending. No M2 UI or import acceptance.

Own checkout `openape-monorepo.worktrees/pods-portable-sharing`, branch
`feature/issue-1419-sharing-export`, canonical base
`6133326303b9d1cf46fd843451f00b918849c6e1` (PR216). Doctor passes; shared Git config
is `core.bare=false`, hooks `.githooks`. Evidence:
`/tmp/openape-pods-sharing-m2/`. Full hooks use one local Vitest worker through
strict Turbo passthrough only; automatic CI remains unit-only.

M1 is accepted: tested source `30c9e83896e2be507c2a673c9a3acb40ea4f43da`, PR216
merge above, source CI5351 and main CI5352 green.
[Verified private Test Runs](https://report.openape.ai/r/OZbajHTMYIjvzknMK4s8V5Hu)
retains 1211 units, three native checks and actual Opus/primary reviews.
Next finish M2 exact-source native review/report/merge acceptance, then M3
journaled import and runtime aliases without renewed plan approval.

## Sharing M1 — issue 1419

Sharing M0 PR215 merged source `a80d22a17e8ffeb9ae9c5db1692ae10fade91a2d` as
`04c20aa8df50bd6e85bca99aa520e355d727c3f4`; source CI5347/main CI5348 pass.
[Verified private Test Runs](https://report.openape.ai/r/KfhzCgbfvZ69e3uGHx5p7k_d)
records 1190 Pods tests, 33 protocol tests, seven tooling tests, actual Opus reviews
and native source verification. M0 is accepted; M11 remains open.
Own checkout `openape-monorepo.worktrees/pods-portable-sharing`, branch
`feature/issue-1419-sharing-dependencies`, starts from that merge. Doctor passes.
M1 imported-lock validation/preparation and read-only application compatibility
resolution are implemented. Root lint/typecheck, Pods build, 1211 unit tests and
three real native dependency checks pass. Actual Opus reviews prompted installed
manifest-edge checks, unlisted-package refusal, candidate isolation and read-only
bundle preview. Final native PR/CI/report acceptance remains pending; evidence
`/tmp/openape-pods-sharing-m1/`. The full unit suite uses one local worker after an
existing central-volume test exceeded five seconds under unrestricted concurrency;
no timeout, assertion or automatic CI change. M2 reviewed export is next.

## Portable sharing — issue1419 / network M11

M11c PR214 merged source `feb5390f7c085b8cfd1de2074853855a889c17a4` as
`667745cbcbb751349c4f83714f4847966e5c04c9`; CI5345/source and CI5346/main passed.
[Verified private Test Runs](https://report.openape.ai/r/j5MqJwC7wapbZtzDrfozh6Bi)
contains1177 units, one native case,17 layout cases, six inspected screenshots,
all20-file native review and actual Opus/Fable reviews. Prior hook-environment
incident and recovery are documented; the final restored pre-push gate passed.
Shared Git config is restored to core.hooksPath=.githooks/core.bare=false, matching
the documented working-checkout topology. Other branches and working files remain.

[Issue1419](https://repos.openape.ai/patrick/monorepo/issues/1419) tracks required
portable file sharing. Dedicated checkout `openape-monorepo.worktrees/pods-portable-sharing`,
branch `feature/issue-1419-pod-workflow-sharing`, canonical base the merge above.
Frozen install, prescribed prebuild and Doctor pass. Manifest contract implementation
and synthetic fixtures are in progress, with actual Opus5.5 architecture review.
See [reference inventory and package boundary](../architecture/pods-portable-sharing.md).
Native composition validation is implemented; 32 protocol tests and 33 focused
composition/workflow-call tests pass. Actual Opus reviews prompted environment,
capability-reference, mail-ancestry and variable-conflict corrections. Full root
lint/typecheck, Pods build, 1190 Pods units and 33 protocol tests pass. Actual Opus
contract review reports no remaining M0 blockers in its stated scope. M0 sharing
remains unaccepted pending native PR/review/CI/report. No importer, application probing, user-data migration or execution is wired.
Next finish that boundary, review/test it, then M1 imported-lock/application resolution.
M11–M14 remain open; existing production/live-action boundaries stay in force.
Evidence: `/tmp/openape-pods-sharing-m0/`.

A pre-commit rerun exposed a check-runner defect: its direct tooling subprocesses
inherit Git-hook repository/config variables before Turbo filtering. Shared
`core.bare` changed to true; restored false, with own ref/index/files preserved.
The runner now strips Git-local variables for child steps; a real two-repository
regression passes. The complete repaired hook passed at commit
`b8dd93565ebb62ebd4bdd618830b18621f5deea9`; shared config stayed intact. Opus
review prompted a stronger real subprocess regression, which also passes. The
initial hook additionally failed an existing IdP fixture during concurrent Nuxt
builds; the supported single-worker rerun passed 632 tests (8 existing skips). No default suite, timeout or CI change.

## Current M11 — issue1417

M0–M10 are accepted. M11a reviewed conversion is merged in
[PR212](https://repos.openape.ai/patrick/monorepo/pulls/212). Tested source
`5a57c5ad765f4588c9a13cda3db1a782be49f689` passed root lint/typecheck, Pods build,
1157 units, three native Electron tests and13 manual layout checks. All27 native
files/1829 displayed lines were reviewed. Actual Opus5.5/Fable5.1 corrections are
included. Exact-source CI5340 and full-main CI5341 passed; merge
`4984a2a31a1b463bf4fe248ece65d52772c50864`.
[Verified private Test Runs](https://report.openape.ai/r/m3ufyiHjZQKDMqlJqLVJ-ZTE)
contains actual logs and six inspected screenshots; category, owner200/anonymous401,
embedded bytes and authenticated browser display verified. Publication-time pending
CI is superseded by the PR review and these CI receipts.

M11b reviewed archival is merged in [PR213](https://repos.openape.ai/patrick/monorepo/pulls/213).
Tested source `0c4a5ec60e173cd9e3a84bd78c355d71f26fc4a3`, merge
`d0a9eb924657cf91ebba32a8ca3a46b66cab51e9`; exact-source CI5342 and full-main CI5343
passed. Root lint/typecheck, Pods build,1165 units, one native route and15 layout
checks pass. All19 native files/994 lines reviewed; actual Opus5.5/Fable5.1 corrections
included. [Verified private Test Runs](https://report.openape.ai/r/JbfTaigfMGAGbUmVb7erkLzj)
contains six personally inspected screenshots; privacy/category/bytes/browser verified.

Own checkout `openape-monorepo.worktrees/pods-workflows-networks`, branch
`feature/issue-1417-pods-networks-m11-composition`, base the canonical merge above.
Doctor passes. Paused composition replacement is implemented but unaccepted,
followed by approved portable sharing. The implemented backend preserves historical
members, source identities, checkpoints, rights and receipts; requires settled work
and fresh added instances; refuses changed retained authority and old approval reuse.
The editor preserves schedules, schemas, gates, joins and values, freezes a reviewed
diff, requires explicit continued pause and warns about fresh-source cursor behavior.
Actual Opus5.5 and Fable5.1 reviews prompted corrections to binding pins, IDs, stale
review handling and unchanged values. Root lint/typecheck and Pods build pass. A standard1177-test run passed, but
mandatory reruns reproduced host-load timeouts in existing volume and other suites.
Temporary fixture experiments were reverted completely. The full local hook is
being rerun with supported `VITEST_MAX_WORKERS=4` and a temporary root-Turbo
configuration that passes only this variable through strict mode. Never use loose
mode inside Git hooks: it leaked Git-local variables into synthetic Git tests.
The own branch/index were restored to the recorded base; all20 implementation
files remain byte-identical, and other refs are unchanged. No test, timeout,
default runner or CI change.
Positive public-run selection uses the existing index, verified by SQLite's query
plan and focused actual Opus review. One native route and17 manual layout cases
pass; six screenshots were personally inspected. Final source review found no
blocking issue in its stated scope. Source `57ddbecc2a09b41b638ac8073b691afc50505aba` is in native PR214.
Post-push verification found the earlier Git-environment incident had also changed
the shared hook path to a removed test directory. The documented `.githooks` path
is restored. The original commit/push therefore do not prove hook success. The
complete affected unit contract was then run directly at that exact source and
passed, including1177 Pods tests; external CI5344 also passed. Final documentation
commit, native review, report and protected merge remain pending. M11–M14 are unaccepted.
No live conversion, production activation or expanded external rights.
Evidence: `/tmp/openape-pods-networks-m11-replacement/` and current
`/tmp/openape-pods-networks-m11-composition/`. Next complete real desktop/layout
checks, inspect screenshots, final review and private Reports/native PR acceptance,
then portable sharing.

## M10 acceptance evidence — issue1417

Clean tested runtime `0bcad342d2d96a4645c687358ba964b04c2b254c` passed root
lint/typecheck, both app builds,1136 Pods tests,34 relay tests,six protocol tests,
seven native checks,18 layout checks and authenticated browser E2E. Primary review
inspected all39 native diff files/1839 displayed lines against canonical source/base;
actual Claude Code Opus5.5/Fable5.1 reviews informed the fixes. Protected
[PR211](https://repos.openape.ai/patrick/monorepo/pulls/211) merged as
`ad16a8f2cf4fa85864472c8cb8750d4feaed33cc`; exact-head CI5338 and full main CI5339 passed.
Main reused67/68 Turbo test tasks; fresh local source tests are separately retained.
[Verified private Test Runs](https://report.openape.ai/r/TIPZLLUeJrGCKBf0UE7ituvS)
contains actual logs, earlier failed gates and eight personally inspected screenshots.
Owner200, anonymous401, exact screenshot bytes and authenticated browser display
verified. The immutable report records pending CI at publication time; the final PR
review and this receipt record subsequent success. Browser E2E uses a real Nuxt/IdP
route with signed synthetic runtime responses; native tests separately exercise
Electron/preload/main/worker. Production desktop/relay acceptance remains M13.
Relay-first rollout is required; a network-bearing profile refuses an older relay
and pauses workspace scheduling. No deployment or live conversion was performed.

## M9 acceptance evidence — issue1417

Clean tested source `4e3c5d9fc3f4baf0acaa5f2e8e066807017afce1` passed full
lint/typecheck, Pods build, 140 suites/1124 unit tests, six native tests and 19
manual layout checks. Exact-source unit CI5336 passed. All 43 native diff files
and 2410 displayed lines match source/base; primary review and actual Claude Code
Opus5.5/Fable reviews informed the fixes. Protected
[PR210](https://repos.openape.ai/patrick/monorepo/pulls/210) merged as
`afbcb7aad45ad16ffccc51077b4b2968806d6c74`; full main CI5337 passed.
[Verified private Test Runs](https://report.openape.ai/r/38IJwxPQM0gwKEsj6JgwZGQY)
retains actual results, earlier failed fixture teardown/fairness gate and eight
personally inspected screenshots. Owner200, anonymous401, rendered screenshot
bytes and authenticated browser display verified. M11 must deliver the reviewed
paused replacement/archive path preserving identities, pending work and effect
receipts before M13. M9 connected-online publication remained explicitly fenced.

## M8 acceptance evidence — issue1417

M0–M7 are accepted. Native PR208 merged as
`a836a97d192e1eeff9f440427806c6de5b35264c`; full main CI5329 passed.
M7 runtime `e7ae6e1cec20149ec31f12363930312e6c2226c5` passed1085 units/four
native tests; final docs `4b07e3ee67ea13d2b5c94da09cc47d03295cf444` passedCI5328.
[Verified private M7 Test Runs](https://report.openape.ai/r/GeG_5EXS3PQGRtT0PJmGCcMS).
Checkout `openape-monorepo.worktrees/pods-workflows-networks`; branch
`feature/issue-1417-pods-networks-m8`; canonical base is the PR208 merge above.
Doctor and23 existing workspace/script/dependency/onboarding baseline tests pass.
The M8 runtime candidate `5cf5c7004b0c4fee850d3fb05a356421f3446370` adds
schema33, immutable definition publication, isolated instances with durable
idempotent provisioning and explicit per-instance version review. Root lint,
typecheck, Pods build and139 suites/1108 fresh unit/component tests pass.
Four manual Electron suites/five tests pass through the actual preload/main/worker
routes, including independent subjects/keys/homes, same-key provisioning retry,
no copied grants, retained paused results and uncertain-effect non-replay.
Four English/German desktop/narrow screenshots were personally inspected.
[Verified private M8 Test Runs](https://report.openape.ai/r/11BVW8loYVf-rTWxSC5SMJAf)
retains actual results and screenshot bytes; category Test Runs, owner200, anonymous401.
[Native PR209](https://repos.openape.ai/patrick/monorepo/pulls/209) is linked to
issue1417. Runtime exact-head unit-only CI5332 passed; primary native review
reconciled all38 files/1935 displayed lines against canonical source/base.
Actual Claude Code Opus5.5 reviews closed the safety findings. Its final optional
recovered-identity reconciliation was implemented and verified at the tested SHA.
Publication never repins existing instances. Restore requires explicit identity
recovery; an already recovered identity completes its receipt without reprovisioning.
Published source Pods can be archived but cannot be deleted while referenced.
UUID-bound HTTP/SSH/application capabilities are refused until portable binding
review in M11. Connected workspace mutations remain visibly unavailable until M10.
Final documentation head `8b2ba1ec280f6e95d645026b18ee39dabcc631d5` passed
CI5333; all39 files/1997 native lines match reviewed source/base. Protected merge
`9eaf5e4e70ae22ebebdf2f2c19c83376f7923b56` passed full main CI5334. M8 is accepted.
M9–M14 remain unaccepted. No production activation, live conversion or rights expansion.

## Approved audit exception — issue 1418

Patrick approved ignoring CVE-2026-85393 on October 2, 2026 and continuing Pods
M7–M14. The exact exception and Nuxt/proxy reachability assessment are in
[dependency audit exceptions](../operations/dependency-audit-exceptions.md).
Checkout: `openape-monorepo.worktrees/proxy-forge-audit`; branch
`bugfix/issue-1418-proxy-forge-audit`; canonical base
`e815dad04ecf0985a7a1bd0f6269604f5b55f46a`.
The original alternative proxy rewrite is preserved in stash
`f82acfcb06d9fab0c0f75b4e6bdd0d9b78c92dec` and is not part of this change.
The audit now succeeds with exactly one ignored high finding. Actual read-only
Claude Code Opus 5.5 review found no blocking issue; documentation was clarified
for the direct proxy path, downstream consumers and exception removal.
Tested source `dbb500b235832d4342727924e438e19f45c397f2` passed root/affected
unit gates and CI5325. Native PR207 merged as `d7119e533c0a3ec123ef04b98b813dc7fe8c5e8f`;
full main CI5326 passed and issue1418 is closed.
[Verified private Test Runs](https://report.openape.ai/r/PM_juju3H8CVz-vl4QcMKznd).
M0–M6 are accepted; staged M7 remains unaccepted in its separate checkout and
its recovery review fixes are continuing. No production activation is included.

## Current M7 verification — October 2, 2026

M0–M6 are accepted; M7 remains unaccepted. Patrick approved the exact
CVE-2026-85393 audit exception in native PR207/issue1418. The previous upstream-only
blocker assessment is superseded; the optional proxy rewrite is separately preserved.
PR207 passed CI/merge/main and was incorporated with the complete owned M7
implementation preserved. No runtime cryptographic replacement is needed.

Current M7 working-tree verification: full root lint/typecheck, Pods build,
137 files / 1,085 unit tests and three manual native suites / four tests passed.
The actual authenticated Electron screenshot was personally inspected: Ready,
synthetic company, finite workflow and distinct caller/source/result/review Pods.
Current labels remain legacy presentation; operational network UX is M9.
Actual native receipts prove two isolated invoice calls/results, paused-result
retention, completed joins and missing-input review without consumer execution.
Recovery fixes preserve queued accepted work, allow owner reauthorization of cancelled
results, retain uncertain gate items, bound finished polling history and settle
conclusively denied/expired required branches without replay. Actual Opus5.5 closure found no remaining blocker. Its low-priority multi-hop
diagnostic observation was tightened to directly prevented terminal branches;
the final full/native checks passed after that correction. Clean tested runtime `e7ae6e1cec20149ec31f12363930312e6c2226c5` passed
exact-source unit CI5327. Native [PR208](https://repos.openape.ai/patrick/monorepo/pulls/208)
is explicitly linked to issue1417; all33 files/2659 native diff lines match canonical
source/base. [Verified private Test Runs](https://report.openape.ai/r/GeG_5EXS3PQGRtT0PJmGCcMS)
retains actual clean-source results and the personally inspected screenshot;
category Test Runs, owner200, anonymous401 and rendered screenshot bytes verified.
Native attachment is unsupported by the app helper; canonical links remain authoritative.
Next verify this documentation head, protected merge and green main before accepting
M7 and continuing M8–M14. No production activation is included.

## Pods persistent networks — issue 1417

[Approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3VDB1S72E4EQQW58T97C617),
[native issue 1417](https://repos.openape.ai/patrick/monorepo/issues/1417).
Checkout: `openape-monorepo.worktrees/pods-workflows-networks`; branch
`feature/issue-1417-pods-networks-m7`; current canonical base
`d7119e533c0a3ec123ef04b98b813dc7fe8c5e8f`; original canonical base
`a99c69bd2b97d8883ce5538894c3f38510407ddf` (Pods 0.1.1, schema 27).

M0 freezes [contracts](../architecture/pods-networks/contracts.md) and the
[complete schema-27 migration inventory](../architecture/pods-networks/migration-inventory.md).
The existing backup API read an existing stopped profile through read-only SQLite
and exported a private isolated archive: 89 tables, 121 files, 20,703,926 bytes.
No live owner/profile/provider mutation. Full root lint/typecheck passed with
Turbo cache reuse; this is a documentation increment, not new runtime acceptance.
[Verified private Test Runs evidence](https://report.openape.ai/r/4pfGRvsu2cUA1T0VgqnmH16e).
M0 [PR 200](https://repos.openape.ai/patrick/monorepo/pulls/200): independent
Claude Code 2.1.286 / Opus 5.5 reviewed the contracts and verified closure of all
blocking/major findings after corrections. The primary agent checked sources and
remaining token/identity wording. Final tested SHA `3b7363b2622b8394c429fe8833c6df49e87742db` passed exact-head CI;
M0 merged as `fb80556d8a66843e028da7d13cda97fd5a9f1d50`.
[Final private Test Runs evidence](https://report.openape.ai/r/3fMyH6tmpepIRy7p8qRhYqzm).
M0–M6 are accepted and merged. M7 is in progress and unaccepted; M8–M14
remain unimplemented. M7 starts from the canonical M6 merge;
M5/M6 runtime acceptance, final exact-head CI and protected merges are recorded below.
M3 [PR 203](https://repos.openape.ai/patrick/monorepo/pulls/203): tested clean
runtime `da209ca697d79c0cade36759d9ccb69aa9167f53` passed root lint/typecheck/build,
133 files / 966 fresh Pods unit tests, four manual native/Electron tests and
exact-head CI 5310. Two unrelated crash cases were skipped by selection.
Actual sandbox A/B independence, source-version deduplication, empty intake,
settlement after pause, untouched legacy checkpoints and preload/main/worker
routing were verified. The final synthetic desktop screenshot was personally
inspected. Repeated actual Claude Code Opus 5.5 reviews confirmed safety closure;
primary native diff review verified all 3,066 displayed lines against the commits.
[Verified private Test Runs receipt](https://report.openape.ai/r/Y_XFy5OH08ad4fPoSStGwAFk):
category Test Runs, owner read 200, anonymous read 401 and inspected screenshot
bytes retained in the published document. Final documentation head
`a3e9c7b697575eef5ddf30afb9b96703d6a884e0` passed CI 5313; native PR 203
merged as `ae4504d8483d464e3794f7864299241de8829df6`.

M3 is a seeded engine vertical slice. Productive definition/instance creation
arrives in M8 after M4 recovery. Central-connected creation is denied before
mutation pending M10. No live profile/source/provider action or expanded rights.
M4 clean runtime `0e5eaed96485cee586475727481d6a5c396753f7` passed root lint/typecheck, Pods build and 134 files /
999 unit tests, including owner-journal transaction isolation and rolled-back
consumer conflict disposal. Five manual native
checks passed (two unrelated crash cases skipped by selection), including actual
worker SIGKILL, stopped-process proof, explicit original-batch retry and exactly
one committed checkpoint. The synthetic screenshot was personally inspected;
existing network members still show as standalone cards pending M9 UX.
Three-network source volume measured 16,503 events / 49,503 deliveries, 50-item
settlement p95 58.62 ms, four real concurrent SQLite writers / 4,000 rows without
loss, and quota refusal with retained checkpoint/markers. This excludes M5 gates,
M6 records and the complete dependent five-stage business fixture. Production
scheduler/lease admission at 1/2/4/8 slots passed with script execution mocked.
Actual Opus 5.5 follow-up findings prompted completed diagnostic retention,
same-boot stop proof, closed owner identity-conflict resolution, fair guarded
master/browser starts, domain error isolation and bounded preview retention.
The pre-commit audit exposed three high-severity devalue advisories. The existing
override now pins quarantined patch 5.9.3 (published September 18), with no new
dependency or relaxed audit threshold; the production audit reports no high findings.
Actual Opus targeted closure confirmed conflict disposal and durable owner-run
journaling. The primary review inspected all 37 files / 2,446 native displayed diff lines,
verified against canonical source/target commits. Native
[PR 204](https://repos.openape.ai/patrick/monorepo/pulls/204) is explicitly linked
to issue 1417. Runtime exact-head CI 5315 passed the unit-only contract.
[Verified private M4 Test Runs receipt](https://report.openape.ai/r/5WUpVPNReI22uBWBuzGVbh0P):
category Test Runs, owner read 200, anonymous read 401 and the inspected screenshot
bytes present in the published document. Final documentation head
`1cb0d57aa3b9f1fbf192c7832ff5698d4cbc2e34` passed exact-head CI 5316;
PR 204 merged as `49dce16e93b7cc4ae07992b84f6eded9c103307c`.

M5 adds versioned downstream gate manifests and additive schema 30 without
changing legacy gate command/summary bytes or historical schema 28/29.
Gate maintenance reserves the downstream instance and global slot without a
script/model launch. Held inputs require exact consumed-grant coverage and
an active-grant check before script launch; unrelated inputs continue.
Owner exclusion supersedes the old grant and requires a fresh batch. Uncertain
create/consume stays unknown; explicit disposal preserves that uncertainty.
Clean tested runtime `c170a7c28e3a8b836ea656018f48284eaee1f708` passes full
root lint/typecheck, Pods build and 135 files / 1,025 fresh unit tests, including
26 permanent gate authority/recovery contracts. Seven manual native checks pass;
two unrelated crash cases are skipped by selection. Actual signed loopback DDISA
once consumption, worker SIGKILL before its response, desktop restart, unchanged
maintenance attempt count, unknown retention and owner disposal without a second
consume are verified. Both clean-source screenshots were personally inspected.
Existing Standalone Pods labels remain pending M9; outcomes are proved through
actual IPC/SQL assertions. Definitions and identities are fixture seeded pending M8.

Repeated actual Claude Code 2.1.286 / Opus 5.5 reviews closed safety/recovery
findings; primary review checked the complete untruncated native diff against its
source/target commits: 33 files / 2,566 displayed lines. A final primary-reviewed
maintenance-disposal guard rejects before inspection and preserves receipts.
Initial clean source `005450dd` hit nine existing five-second timeouts and stopped
before push. Nine affected suites then passed 161 checks with one worker and
unchanged timeouts; subsequent complete default-concurrency runs passed. No runner,
retry, CI or timeout configuration changed. Root Turbo cache reuse is disclosed.
Runtime exact-head unit-only CI 5318 passed all 1,025 Pods tests.
Native [PR 205](https://repos.openape.ai/patrick/monorepo/pulls/205) is explicitly
linked to issue 1417. [Verified private M5 Test Runs](https://report.openape.ai/r/0vlx3rT-L2Q2NdG5kbgYizCT):
category Test Runs, owner read 200, anonymous read 401 and both inspected screenshot
bytes present. Final documentation head `dbbb2f2918520c55974d708de4296c6dd6676873`
passed exact-head CI 5319; final native review verified 33 files / 2,585 displayed
lines. Protected merge `710c7b65af5a8d4c8e6a2753c75caeaf0dd5aa6d` completes M5.
M6 scoped shared collections/artifacts started from that canonical main in the
same isolated checkout and is now accepted, as recorded below. M9 retains the bounded operational failure-list work; missing
historical process proof stays fail-closed. Never repeat unknown external effects.

M6 is accepted and merged through native PR206.
Native [PR206](https://repos.openape.ai/patrick/monorepo/pulls/206) is explicitly
linked to issue1417. Clean tested runtime
`e5050467cfb91f9ba0545ffe503bf370fc819526` passes root lint/typecheck, Pods build,
136 files/1,058 fresh unit tests and eight selected manual native checks; two
unrelated crash cases are skipped by selection. Root Turbo cache reuse is disclosed.
Schema31 adds scoped CAS records, provenance, declared indexes, separate configuration
origins and managed artifacts. Stale writes or late emission failure roll back records,
events, checkpoint and metadata. Five production SIGKILL points prove stable-byte,
staging, record, event and committed boundaries. Referenced and retained uncertain
artifacts survive encrypted backup/restore and trace pruning; stopped-process proof
and explicit owner journaling precede abandonment of uncommitted drafts.

New v3 gates pin data/configuration; historical v1/v2 command bytes remain unchanged.
Stored v2 grants accept empty authority and supersede added configuration without
consume. Script settlement checks the pin even without staged writes. Automatic
infrastructure retries retain original pins; explicit owner retry journals a fresh
pin and subsequent admission freezes it. UTF-8 byte ordering matches SQLite for
Unicode cursor/range queries, whose response pages remain within192 KiB. Artifact
frames are initially limited to128 KiB; historical backup retains256 MiB artifacts.
Maintenance faults retain one bounded current status/counter per network/operation.

Repeated actual Claude Code Opus5.5 reviews and primary review closed authority,
cleanup, uncertainty, retention, retry and Unicode findings. One Opus closure denied
reading the prior `/tmp` review but inspected repository sources/tests; none ran tests.
Primary native review independently matched all28 files/1,873 displayed lines to
canonical source/base commits. Exact runtime unit-only CI5322 passed.
[Verified private M6 Test Runs](https://report.openape.ai/r/EFk69QK5P2sGYg1yKqwwKA9w):
category Test Runs, owner200, anonymous401, personally inspected actual screenshot
bytes present. Native sharing/denial is proved by the measured private settlement
receipt; public run diagnostics remain redacted. Existing Standalone labels are M9
work, and definitions/configuration/bindings remain fixture seeded until M8/M9.
No productive owner/provider action, live conversion or expanded rights. Final
documentation head `360b4f07f4d49ca3b72f78afc9c3088573d16bfb` passed CI5323;
protected merge `e815dad04ecf0985a7a1bd0f6269604f5b55f46a` passed canonical
main full unit CI5324. Final28-file/1,894-line native diff matches reviewed commits.
M7 begins on the separate milestone branch from that main. Doctor and61 existing
workflow/item-flow/mail-workflow baseline checks pass. Implement named workflow
ports, immutable call snapshots, idempotent correlated results and explicit joins;
M7 remains unaccepted.

M7 working tree adds immutable versioned workflow ports and frozen member pins,
atomic caller-settlement proposals, scoped durable calls/results, per-workflow FIFO,
explicit case-revision joins, required owner decisions and decision-only maintenance.
The latest working-tree full Pods unit run passed 137 files / 1,076 tests;
root lint/typecheck and Pods build passed. Historical schema-28 migration fixtures
now explicitly remove M7 indexes before replaying the unchanged historical boundary.
Actual Electron/preload/main/worker/native workflow-call acceptance passed with two
distinct invoice/child/terminal results, paused-network result retention and missing
join review. The combined four-test native regression passed before the latest
review fixes; the current repeat and final clean-commit evidence are pending.
The personally inspected authenticated existing route is readable; future M9
operational network/result UI is not claimed.
Actual Claude Code Opus 5.5 reviews led to restored-call fencing, audited owner
resume, an explicit retained-effects incomplete-result resolution, permission checks
before unfinished steps, per-Pod decision polling, eligible queue/delivery scans,
cancellation reconciliation and bounded maintenance retention. Oversized finite
inputs are rejected before script processing; completed work never automatically
replays. Actual Opus final review is running; findings remain subject to verification.
M7 remains unaccepted. Native PR, final clean tested SHA, verified report and exact-head
CI are pending. Next: close final review findings, test final committed source,
publish verified evidence, review/merge the milestone PR and continue M8–M14.

M1 prototype: 24 crash/authority checks pass; selected established scheduling
suites pass (120 checks before the two final isolation assertions). Maximum-payload
stress has 195,000 receipts/events, 255,000 deliveries and 30,000 record revisions.
The compacted retained database is 96,526,336 bytes. Transactional queue-count
projection replaces an observed full-scan bottleneck; see
[measured limits and dependent gates](../architecture/pods-networks/prototype-findings.md).
M1 [PR 201](https://repos.openape.ai/patrick/monorepo/pulls/201) is linked to
issue 1417. Tested temporary-fixture SHA
`26684ec0986d1e3d119ba54cb0ca6c1b25139065` passed full root lint/typecheck,
Pods build and six focused suites (123 tests). Independent Opus reviews verified
code-blocker closure and targeted evidence corrections. The final commit removes
the temporary volume fixture. Final head `d504c40ad3a0cb8e092fc7147311ef6fb31a2d51`
passed external CI and merged as `df832d9d816b97f404eb9f260c834ad8606ed080`.
[Actual private M1 Test Runs receipt](https://report.openape.ai/r/V1vrDbaXR3kynVJ1ujIBn4Ox). M1 step 4 measures logical CAS only; actual writer contention and implemented
join measurements are explicitly deferred to M3/M4/M7.
This is test-only SQL design evidence, not product engine or encrypted-restore
acceptance. M2 [PR 202](https://repos.openape.ai/patrick/monorepo/pulls/202) adds schema 28,
paused/revoked restore and encrypted backup support with activation hidden.
Runtime source `7dc40d6352d0d7cd994d729db89c0b6a115d4c25` passes clean root
lint/typecheck, build, all 905 Pods tests and exact-source CI run 5307. Isolated
schema-27 migration preserves 89 legacy tables, 15,334 existing files and all 86
credential files; original source unchanged, rollback/reopen/encrypted round trip
and actual older-app refusal verified. Three full-file Opus 5.5 reviews and one
targeted closure accompany primary review. [M2 storage evidence](../architecture/pods-networks/m2-storage-evidence.md).
Final documentation head `c8418561b176667a6965d31635173fe123145541` passed
CI run 5308; native PR 202 merged as
`b35620900fce67fe4d4804573df1d7edcb9f3c5e`.
[Corrected private M2 Test Runs receipt](https://report.openape.ai/r/_Y36InfIXpYhK1Bc0ro0kMz2).
Patrick requests an additional Claude Code Opus 5.5 UX review when M9 is reached;
record its actual availability/result without substituting a claimed review.
Production pilot, live conversion and concrete actions keep their separate gates.

## Pods CI acceleration verification — issue 1416

Worktree: `openape-monorepo.worktrees/pods-ci`; branch:
`feature/issue-1416-pods-ci`; base: `602c365702949b51c3286895d176b20f0a3ace44`.
Native [PR 199](https://repos.openape.ai/patrick/monorepo/pulls/199) owns the
exact-source merge state; [issue 1416](https://repos.openape.ai/patrick/monorepo/issues/1416)
owns closeout. Implementation SHA: `f81ec01c36816a69d9bf8895753f5bad30459dab`.

Serial prebuilds cover only selected libraries/modules, consumed CLI apps and
their transitive dependencies. A pure Pods selection has 11 build workspaces
rather than 32; local isolated cold-cache timing is 21.405 s versus 32.627 s.
The permanent dependency-closure regression protects clean CI from missing
build outputs. Required unit gates and manual-only E2E/layout routing remain.

Forgejo run 5293 passed the complete cold contract (9m35s), saved both caches
and finished successfully; its v3 post-job phase took 10m15s. Run 5294 passed
at the implementation SHA with both caches restored: unit contract 32s, total
job 2m26s, post-job 11s. Download restore plus installation was 60s, versus
cold installation alone 54s; this pair does not prove a standalone installation
speedup. Root lint/typecheck, tooling lint, six contract tests, complete local
hooks and workflow schema validation pass.

The runner now uses the fixed internal cache endpoint; its restart waited for
an idle runner and the temporary firewall rule is removed. Both cache actions
are pinned to Forgejo v4. Configuration backup and rollback are documented in
`docs/operations/checks.md`.

[Verified private Test Runs evidence](https://report.openape.ai/r/9Zn-8i68bYLyNoqxttXnpXyM).
This records measured cold/warm behavior, not a guaranteed duration for future
changes or a claim that cached tests executed again.


## Pods networks and workflows presentation — issue 1410

[Issue 1410](https://repos.openape.ai/patrick/monorepo/issues/1410) delivered the
approved N1–N3 follow-up in the [existing graph plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3PF2RKZPA2V0AQ2SJTXD6DX).
[PR 192](https://repos.openape.ai/patrick/monorepo/pulls/192) reviewed source
`824c33b881c2b90c7e02b6bb2dd612d3beaa71b4`; merged and installed application
source `c2325494bd0ccc40bed3b75e0553aab47ad313bf`.
Own checkout: `openape-monorepo.worktrees/pods-network-presentation`;
implementation branch `feature/issue-1410-pods-network-presentation`, receipt
branch `feature/issue-1410-pods-network-delivery`.

The shared overview distinguishes channel networks and sequence workflows,
retains mode filters through detail navigation and reuses existing creation
editors. Structure/run explanations, subdued unused delivery paths, readable
channel contracts and separate deduplicated choice/approval counts improve the
inspector. Runtime guidance and both handbooks explain prompts, bounded local
loops and validated graph handoffs. No schema, engine, authority or dependency
change. Original issue 1407 M9 mail-production acceptance remains open.

Root lint/typecheck and Pods build pass; 843 unit/component tests and 42 real
browser layout tests pass. Exact-source and merge CI pass. Clean merged
`pnpm check:ci` passed all seven steps; receipt
`.openape/check-results/1790795526764-c2325494-unit/summary.json`.
The signed/notarized internal DMG passed mounted distribution acceptance and
an isolated native profile verified contracts, filters and saving a disabled,
unscheduled sequence through the existing editor. DMG SHA-256:
`83b46338c6f37190d0ace5444e641d625eeb976ca4d9373ef66b144f622e7a04`.

Relay image `registry.openape.ai/openape-pods-relay:prod-c2325494` passed the
production read-only smoke and health gates. Provider discovery/JWKS fingerprints
remain unchanged. Installed at `~/Applications/OpenApe Pods.app`; ASAR matches
the signed candidate. Paired app/profile rollback:
`~/Library/Application Support/OpenApe Pods Rollback/2026-09-30-213318-network-presentation/`.
All 15,336 profile files were byte-identical during replacement. After online
acceptance, schema 27, 38 stored Pods (37 current), identity/registration rows,
connections, scripts/resources, groups, workflow/schedule configurations and
pending graph data have unchanged fingerprints. The encrypted registration file
changed after reconnect; preserve current rotating state rather than restoring
an old full profile. Active runs remain zero; MCP remains off.

[Verified private Test Runs report with ten inspected screenshots](https://report.openape.ai/r/lL6fN5Au5IfSy0sRUr2Y0ahE)
separates fixtures, signed local candidate and actual installed/deployed evidence.
Published image bytes, private visibility, Test Runs category and anonymous
access denial were verified. The owner desktop/browser show online; mode filters
survive detail navigation, historical item traces and readable contracts remain
available, and the sequence editor opens/cancels without saving. Browser gate
choices remain disabled. Three Delta Mind/two IURIO choices remain unchanged.
No real run, schedule activation, choice, approval, send or archive was triggered.

## Linde server reporting — issue 1409

[Issue 1409](https://repos.openape.ai/patrick/monorepo/issues/1409) implements the
[approved first-component plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3QN4YQPBMX31GK4KCN4E5EF).
Own checkout: `openape-monorepo.worktrees/desktop-graph-integration`.
PRs 187–190 delivered bounded SSH, the actual worker route, spaced-path handling,
reporting completion semantics and the renewed fullchain certificate source.
Installed signed/notarized build 2e3d979f preserved all 15,336 profile files,
38 Pods, runtime identity and logins. Delta Mind/IURIO graphs, run counts, item
traces and gate views were visually checked without making gate decisions.
The real schedule save exposed a Vue proxy crossing Electron IPC. Branch
`bugfix/issue-1409-workflow-metadata-clone` serializes the preserved metadata and
extends the component regression with structured-clone enforcement and successful
save completion. Full lint/typecheck, build and seven focused workflow tests pass.
Exact-head CI and final installed save acceptance remain pending. Live setup also
awaits owner confirmation for a new temporary MCP write window after its expiry;
never extend access or edit the live database to bypass it.

One independent sequence workflow contains only `Linde · Server report` for
Monday/Thursday 08:00 Europe/Vienna. Its Pod is paused in preview mode and the
workflow is disabled. All six original draft Pods remain paused. Private report
publication and Delta Mind Telegram delivery were verified in the first failed
inventory run; no later preview sent messages. No server maintenance is part of
the recipe. Next: reviewed PR, signed install, renew the fixed resource bindings,
verify the installed report and notification, then activate only this workflow.

## Pods graphs — issue 1407

[Issue 1407](https://repos.openape.ai/patrick/monorepo/issues/1407) tracks the
[approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3PF2RKZPA2V0AQ2SJTXD6DX).
M0–M8 are delivered. The missed M6 connected desktop entry is repaired by
[PR 185](https://repos.openape.ai/patrick/monorepo/pulls/185): reviewed source
`74b14ddc8f302f25f89f92293b33d01bc64bb9c0`, canonical merge and installed build
`559622559bf75a55d5fea70804a66b6cf4b20624` (identical Git tree).
Own checkout: `openape-monorepo.worktrees/desktop-graph-integration`;
implementation branch `bugfix/issue-1407-connected-desktop-graph`, acceptance
receipt branch `bugfix/issue-1407-desktop-acceptance`.

DesktopWorkspace now uses GraphPanel and organization state. Full root lint and
typecheck, Pods build, 823 unit/component tests and 42 browser tests pass. Three
connected-shell regression tests fail against the original shell and pass after
the integration. They cover groups, edges, counts, traces, choose/approval
commands and group creation; existing sequence interaction tests remain active.
Exact-source external CI and merge CI pass. The explicit deployment check passed:
`.openape/check-results/1790764566922-55962255-unit/summary.json`.
The required audit needed quarantine-compliant undici 8.10.2 and brace-expansion
1.1.20/2.1.6/5.0.11 patches; zero high findings, no new dependency or exception.

The signed/notarized internal DMG passed mounted startup and deterministic local
execution. SHA-256:
`a128fe994ce16c8b28034ac73dcaec1e270556f1b0ca49c884b935e69c5ea26c`.
Installed at `~/Applications/OpenApe Pods.app`; installed ASAR matches the package.
Paired rollback backup:
`~/Library/Application Support/OpenApe Pods Rollback/2026-09-30-124718-desktop-graph/`.
All 15,276 profile files were byte-identical during replacement. After restart
and UI acceptance, schema 27, runtime registration, five connections, 37 Pods,
scripts/resources, groups, workflows/schedules and graph data remain unchanged.
Never restore this old full profile over later owner work.

[Private Test Runs report with ten inspected screenshots](https://report.openape.ai/r/_MwRqvtRDHslPP5lNc70ZakW)
verifies the actual installed, centrally connected Delta Mind and IURIO graphs:
groups, nodes/edges, last-run counts, item traces, three/two held choices, the
empty approval state and the sequence editor. Published screenshot bytes and
private Test Runs category were verified. M6 was marked accepted only afterward.
No graph schedule, real choice, approval, send or archive action was triggered;
MCP access remains off. Pending-batch actions are covered by synthetic tests.
The existing 07:00 Morgenbriefing run remains blocked by a prior permission-service
503; its recovery controls were inspected without retrying it.

Next: M9 production acceptance remains open under its existing owner constraints.
The connected desktop integration correction is complete.

## Pods infrastructure recovery — issue 1405

[Issue 1405](https://repos.openape.ai/patrick/monorepo/issues/1405) is delivered via
[PR 174](https://repos.openape.ai/patrick/monorepo/pulls/174), reviewed source
`3cdc3531c7f40ca1e041fdbb447c1e0a04b2b69c`, canonical merge
`3cf34b01758905e2968e0334213c1220301698ae` (identical Git tree).
Own checkout `openape-monorepo.worktrees/pods-infrastructure-retry`; implementation
branch `bugfix/issue-1405-pods-infrastructure-retry`, receipt branch
`bugfix/issue-1405-delivery-evidence`.

Trusted transient authorization/read errors retry the same operation with 2–60
second backoff. Pre-script outages release capacity with persisted retry metadata
(schema 25). Script execution, checkpoints and ambiguous effects prevent whole-run
replay. Owner pause/cancel and changed permissions stop retries. JWKS/consume
transport hooks preserve signature and grant validation. Active shared Overview
and schedule settings show the next retry and prevent conflicting manual starts.
The required audit also needed the targeted, quarantine-compliant fast-uri 4.1.4
security patch.

Verified: full lint/typecheck, Pods build, 674 Pods tests, 257 grants tests,
632 apes tests (eight existing skips), 13 native dispatcher cases, seven legacy
browser cases and one active shared workspace case. Exact-source external CI
passed after one diagnosed pnpm launcher stall and a normal unchanged-source
rerun. Clean-merge `pnpm check:ci` passed; receipt:
`.openape/check-results/1790648157798-3cf34b01-unit/summary.json`.

The signed/notarized internal DMG passed isolated startup and deterministic
execution. SHA-256: `de899ce0aa4b25ab105326865729eb941ce103c24b12ab822e86e070ba22b2a3`.
The app is installed at `~/Applications/OpenApe Pods.app`; its ASAR reports the
reviewed source. Paired previous app/profile backup:
`~/Library/Application Support/OpenApe Pods Rollback/2026-09-29-041643-issue-1405/`.
Schema migrated 24 → 25; configuration fingerprints of nine Pods, seven schedules,
35 resources, 41 scripts and one workflow are unchanged. Two natural zaz runs
completed after installation; central scheduling has no error, pending input or
blocked input. No production outage was injected and no server deployment was
needed. Never restore the old full profile over subsequent owner work.

[Final private Test Runs evidence](https://report.openape.ai/r/LGPjRm2DuVq_baujyJaHGauM)
contains backend results and two personally inspected screenshots; published image
bytes and the private Test Runs category were verified.
[Completed plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3N9DHVZSN98TPTDTE2NFGWJ)
is mirrored in `.claude/plans/issue-1405-infrastructure-recovery.md`.
No product work remains.

## Pods browser/desktop visual parity — issue 1404

[Issue 1404](https://repos.openape.ai/patrick/monorepo/issues/1404) is delivered via
[PR 171](https://repos.openape.ai/patrick/monorepo/pulls/171), reviewed source
`19517fa221683e4e4d005c85c70524bc6a85992a`, canonical merge
`2943d7acdd6942b680fec7dc9c8f7f60b5f9622e`. Own checkout:
`openape-monorepo.worktrees/pods-workspace-landing`; implementation branch
`feature/issue-1404-browser-desktop-parity`, rollout receipt branch
`feature/issue-1404-rollout-evidence`.

The browser shares the desktop frame, Workflows, inventory, six Pod views and
App settings through explicit HTTP/native adapters. Local-only capabilities remain
explicitly desktop-only. Snapshot updates refresh untouched forms while dirty
inputs retain their original revision. The public landing and DDISA flow remain.

Verified: full lint/typecheck, both app builds, 654 Pods tests, 29 relay tests,
three paired layout/welcome cases, real disposable DDISA Chromium acceptance,
exact-source external CI and clean-merge `pnpm check:ci`. The relay is deployed as
`registry.openape.ai/openape-pods-relay:prod-2943d7ac`; previous healthy image
`prod-96196057`. Health, public routes/assets and unauthenticated session rejection
pass. The actual owner session verified the workflow graph, Pod links, all six
Pod views, archive and App settings without browser errors or data mutations.

[Final Test Runs rollout evidence](https://testrun.openape.ai/r/B5Q-99zJDP4J8bEE3X4-imhV)
links the inspected synthetic comparison screenshots. Private production screenshots
were inspected without publishing owner data. [Completed plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3MQ93SGG9D2W2R80HYCREK9)
is mirrored in `.claude/plans/2026-09-28-pods-browser-desktop-parity.html`.
No product work remains for this issue; no native desktop binary was released.

## Pods public workspace entry — issue 1403

[Issue 1403](https://repos.openape.ai/patrick/monorepo/issues/1403).
Checkout `openape-monorepo.worktrees/pods-workspace-landing`, branch
`feature/issue-1403-pods-workspace-landing`, base `e5c1814c`.
The relay serves a public workspace landing page at `/` and reuses the existing
DDISA login handler. The shared welcome screen supports retry, pending submissions
and failed callbacks; sign-out returns to `/`. The proxy routes only the additional
exact root path to the relay, preserving agent identity routes.
Full lint/typecheck, relay build, component/layout checks and the existing real
DDISA relay E2E provide acceptance. Production discovery for the owner resolves
to `id.openape.ai` with the workspace callback and S256 PKCE. The native PR records
the exact tested source, external checks and inspected Test Runs evidence.
Next step: merge after exact-head checks and deploy the relay plus root proxy route.

## Pods Variant A — issue 1402

[Issue 1402](https://repos.openape.ai/patrick/monorepo/issues/1402),
[approved scope and plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3M9ZTF4N6PQR30V8CM6MQCX).
Checkout `openape-monorepo.worktrees/pods-ux-verification`, branch
`feature/issue-1402-pods-ux`, base `d1da9ac7aff30f1425ffbbae08b91866bf85b99d`.

Shared Workflows/Pods/Settings navigation, current/archive inventories, native
Pod editing from the central desktop, three personal accounts and app-wide timed
MCP off/read/write access are implemented. The manual `report --browser` mode
captures real components and production CSS into a fresh evidence directory.
Full monorepo lint/typecheck and initial component/browser checks passed. The
linked native PR owns the final tested source SHA, Test Runs report and external
CI result. [PR 169](https://repos.openape.ai/patrick/monorepo/pulls/169) is merged;
the owner-requested signed local installation completed on September 28.
Build `0.1.0+fbd0188b` passed mounted-DMG acceptance and owner UI verification,
with paired rollback and unchanged Pod, schedule and workflow rows.
See the [installation report](https://report.openape.ai/r/mNLilvsZA48fCLkTP944g52n)
and [inspected UI report](https://report.openape.ai/r/gRqECh3W9qN9RJMHfZGeLQzw).

## Generic Reports acceptance — issue 1401

Implementation PR 166 and release-version PR 167 are merged. Reports image `prod-e40ae6ea` is healthy after clean-main `pnpm check:ci`; previous image `prod-7bab2ba6` was rehearsed against migrated data. Production preserves every original legacy row. Real PR and morning previews passed without Telegram sends; the activated PR monitor already completed one natural report and confirmed Telegram notification. Test Runs evidence and guidance are verified.

Current branch `feature/issue-1401-reports-acceptance` starts from canonical `983583f8`; dedicated clone `openape-monorepo.worktrees/generic-reports-release`. See [migration matrix](../operations/generic-reports-migration.md) and [live receipt](../operations/generic-reports-live-receipt.json). Remaining external blocker: npm login expired; CLI 0.3.0 registry release awaits owner renewal. Keep issue 1401 and its plan open until that publication is verified. No further Pod run or notification is needed for acceptance.

## Morning editorial workflow (September 28, 2026) — deployed

[Issue 1400](https://repos.openape.ai/patrick/monorepo/issues/1400), [PR 164](https://repos.openape.ai/patrick/monorepo/pulls/164), [approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3KEEMTW4EN59AFD8HP34X7F). Implementation merged as `0b8216bb1b17269bbaa5c1d03cb919ee45b87fae` after exact-source CI 5201. Full lint/typecheck, Pods build and 623 unit tests passed; the clean merged deployment gate `pnpm check:ci` passed (`1790582152595-0b8216bb-unit/summary.json`).

The existing workflow is active at revision 7, daily 07:00 Europe/Vienna. Mail evidence and Calendar/Issues collection feed the dedicated German editorial Pod; the existing sender consumes only its validated report. New source Pod `51832859-53e0-4cbc-a44c-61ad76aad931` and editorial Pod `6c9d0c12-32fa-4d56-a84a-9a035a030914` are active without independent schedules. The mail approval poll remains enabled every 60 seconds; the sender schedule remains disabled and Daily action website remains paused. Reports server stays at `prod-7bab2ba6`.

Actual manual workflow `e6e4d970-e88a-4857-a7d2-e1b0c94ac6a8` completed all four nodes. Private preview publication `01M3KGPJA9V7B7SWKB9Y2VTDWG`, version 1, digest `48a9b702a3312c64b221f9de1c815eda230b71d2f07f0966bf0acd732b99d48c` matches the frozen payload and server receipt. Editor-only replay `59f48f07-ad72-4b21-8370-a4ecc491af11` completed using its saved input, with only agent operations and no provider, publication or delivery operations. Preview sender has one completed Reports effect and zero Telegram POSTs. Sender checkpoint 26 retains message 243 and September 28 delivery, with no pending operation. No archive grant was created or consumed by the preview.

Owner latest/dated API access and anonymous page/API/asset/publication denial pass on both domains. German copy and consolidated mail cards were inspected directly in Firefox at desktop and 390×844 mobile size. The answered MIAS conversation has no next action. Standard preview series was restored and the temporary replay selector removed; final scripts were revalidated. The next regular delivery is September 29 at 07:00; this manual preview does not prove that future delivery.

Patrick explicitly confirmed the targeted Repos authentication transfer for the new source Pod. Supported private-file `program importState` plus the existing bootstrap pattern initialized only that isolated program's login/signing state; temporary import files were removed. Actual native source reads succeeded for both calendars and owned issues, including forced token renewal. The source remains limited to calendar and issue reads. Editorial receives only its read-only evidence directory and no provider or delivery capability.

Receipt checkout `reports`, branch `feature/issue-1400-editorial-receipt`, base `0b8216bb`. Only installation evidence changes after PR 164; no new application deployment.

## Pod archive and deletion: issue 1399

[Issue 1399](https://repos.openape.ai/patrick/monorepo/issues/1399), branch
`feature/issue-1399-pod-deletion`, checkout
`/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo.worktrees/pods-delete`,
base `5a84e911567c7c77735c548781ac2379c510b9c0`.

Central desktop/browser Settings now exposes archive and an explicit deletion review.
MCP uses the same `workspace` command stream with `data/deletePod`. Existing idle,
archived/name/revision and workflow-reference checks remain enforced. Coordinated
cleanup erases local keys and files and current central artifacts; operation receipts
remain owner-scoped and readable after the Pod disappears. Shared chat history, prior
receipts, backups and remote identities/grants remain.

Verification: full root lint/typecheck, Pods and relay builds, 605 Pods unit/component
tests, 28 browser layout tests and 27 relay tests pass. New permanent checks cover
consequential deletion contracts: confirmation/cancel/refusal, cleanup, stable retries,
receipt ownership and preserving unrelated artifacts. EN desktop/light and DE
390-pixel/dark deletion reviews were visually inspected.
[Verification report](https://testrun.openape.ai/r/fjbkBDEeOW0PnVuzaQk7mfyw).
[PR 163](https://repos.openape.ai/patrick/monorepo/pulls/163). Next: exact-source external checks and coordinated relay/desktop rollout; no owner Pod has been deleted.

## Reports briefing corrections (September 28, 2026)

[Issue 1398](https://repos.openape.ai/patrick/monorepo/issues/1398). Own checkout `reports`, branch `bugfix/issue-1398-briefing-context`, base `5a84e911`. German briefing copy, one mail presentation and fresh sent/incoming conversation evidence before suggesting reply actions. Existing archive policy, schedules and Telegram receipts remain unchanged. Verified: full lint/typecheck, Testrun build, 603 Pods unit tests, 45 Reports unit tests, 8 component/layout tests and 4 authenticated HTTP/browser tests pass. Phone/desktop light/dark screenshots were inspected directly. Next: native PR, tested-image rollout and actual no-send workflow preview. Delivered editions remain immutable; only new publications receive revised generated content.

## OpenApe Reports (September 27, 2026) — deployed; scheduled acceptance pending

Owner follow-up: Reports is the general product; briefings and test runs are specialized formats. Branch `feature/issue-1397-reports-home` from `dc40f3a7` corrects the landing page, private collection labels and default page metadata. This is a presentation change; the existing publication contracts and owning workflow remain in place. Verification and final deployment receipt belong to issue 1397.

[Issue 1397](https://repos.openape.ai/patrick/monorepo/issues/1397), [approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3HW6FG47VR534XC5EAFNS1R). Isolated checkout `reports`, receipt branch `feature/issue-1397-rollout-receipt`, based on merged main `972df1b8715db1e3166f7c09bd28762496ca03b4`. Implementation [PR 158](https://repos.openape.ai/patrick/monorepo/pulls/158) source `2873623ad08664a00f2371e84bdb2b836d0e13c9` passed exact-source external CI run 5187 before merge.

**Implementation and deployment accepted.** Chatty runs healthy `prod-972df1b8`, deployed through the existing tested-image pipeline from clean `reports-release` after `pnpm check:ci` (`1790532415331-972df1b8-unit/summary.json`). Exoscale A record `report.openape.ai` points to `85.217.175.26`, TTL 300; its explicit Traefik router shares the Testrun service. Public TLS/health and real owner login on the alias work. Existing canonical CLI/SP identity remains `testrun.openape.ai`. All 283 legacy runs, 168 archives and 695 assets were compared in both directions against the protected pre-migration database backup: zero differences; SQLite integrity passes. Existing test JSON differs only by the additive `type: test` discriminator.

Minimum safe rollback is [PR 157](https://repos.openape.ai/patrick/monorepo/pulls/157), `prod-183395e4`, retained as `TESTRUN_TAG_PREV`. It was rehearsed against the final schema with private head/archive/assets and shared test data. Do not deploy older images after private content exists. Protected database and edge backups are under `/home/openape/backups/reports-2026-09-27/` on Chatty.

Focused checks pass: 45 Testrun unit tests, 107 auth tests, 7 browser component/layout tests, 14 HTTP/CLI/browser tests, 600 Pods unit tests and four CLI tests. Both login origins and phone/desktop light/dark screenshots were inspected. Full root lint/typecheck and both affected app builds pass. [Public synthetic evidence](https://testrun.openape.ai/r/AeJDx48LWOG_vVrS_KKBgCsv) contains no personal briefing data.

**Actual no-send preview accepted.** Workflow `30030e0b-5476-4afe-99c2-e36dd96d318a` and sender run `e7f21c3e-cb2a-4450-9717-1e018fe03077` completed with real sources. Private edition `01M3J13JNVV58VYBV6JHM57NM6`, version 1, digest `c8f15b19e1be1b5a254fb87ee41a3b86adebd92c5448b143955d36eb4905d46f` matches the server receipt and checkpoint 18. Exactly one completed Reports HTTP effect exists for that run; zero Telegram send effects. Prior message 242 and daily delivery state remain unchanged. Owner production UI was inspected; anonymous API/asset/version GETs return 401, HEAD returns generic empty 404, and pages expose only login on both domains.

**Next: M6, first regular Reports delivery.** Sender hash `354055afdf1dccb596663e7ae1012bd6d824c86c0519b48204f584e390179b7b` is validated and active with `publication_mode=live` revision 2. Workflow `5f7ea0d7-1f9c-4c74-8c8a-afd513950001` remains revision 6, daily 07:00 Europe/Vienna; next September 28. Sender's independent schedule stays disabled. Mail-review script and its approval poll are unchanged; Daily action website remains paused. Dedicated DDISA publisher may publish only to the two owner-bound series. Manual runs use the separate preview series and never send Telegram. A single read-only Codex follow-up is scheduled for September 28 at 07:10; it does not generate or send anything. Keep issue and plan open until actual scheduled publication and Telegram receipt match. No extra Telegram test messages.


## Pods: contact protection and Jev evaluation (September 26, 2026)

[Issue 1396](https://repos.openape.ai/patrick/monorepo/issues/1396), [approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3FKATZRY0Z3BY2YMMMVEFW9). Existing checkout `mail-briefing-grants`, branch `feature/issue-1396-mail-protection-jev`, base `40113402`.

The assigned Microsoft companion retains a per-mailbox union of Sent Items To/Cc/Bcc recipients and enforces an owner-controlled address/domain policy before proposals and actual moves. Incomplete scans and conversation evidence prohibit archival. Jev supplies bounded structured decisions and priorities; free-form LLM calls only summarize selected important messages. A local-only private-file import initializes a missing native Jev connection without exposing its key or implicitly assigning it to a Pod. Changed application bindings expire old pending archive batches locally and require fresh owner review.

PR 154 is merged at 84ccff34 and the signed f182add0 app is installed with all 14 Pods preserved. Existing decision polling is disabled during rollout. The first live preview failed closed on Jev context size; bugfix/issue-1396-sent-delta-pages uses a conservative 24 KB state bound, Microsoft delta page-size headers and progress logs. Final source/check/PR, contact counts, Jev acceptance and schedule receipts belong to the issue. No mail may move during setup; keep manual per-batch approval and use preview delivery during acceptance.

## Morning mail triage and archive approvals (September 26, 2026)

[Issue 1395](https://repos.openape.ai/patrick/monorepo/issues/1395), [approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3F3FK9MX2BH6QWBCWBZZCJE). Checkout `mail-briefing-grants`, follow-up branch `bugfix/issue-1395-archive-service-lifetime`, [PR 153](https://repos.openape.ai/patrick/monorepo/pulls/153). PRs 150–152 are merged. The dedicated archive service uses exact manually confirmed once grants, frozen readable mail metadata, version/folder rechecks and durable uncertain outcomes. Generic program calls remain read-only. Follow-up fixes cover mailbox read permission reuse, the archive script boundary and native request lifetime, and owner workflow controls in connected desktop settings.

Native/renderer source `7c104c0436eae9a2e9202aec69f33012831d7ff4` passed full lint/typecheck/build, 576 unit/component tests, 26 browser component tests and the full local deployment contract. Recipe source `c0d7e1ea217874926d6c80aca108c670497a56eb` adds explicit mail dates and invalidates older relative-date summaries. The real two-node workflow preview `a9993b53-1146-40e8-8eec-09e3f42a6aab` completed both nodes with 338 reviewed messages, zero gaps and no Telegram send. A second preview verifies the corrected date summaries. Workflow `5f7ea0d7-1f9c-4c74-8c8a-afd513950001` is configured for 07:00 Europe/Vienna, initially disabled and paused. Next: finish exact-head CI, native grant acceptance, owner UI verification and the single-schedule cutover. Final signed artifact, paired backup, concrete grant and activation evidence are recorded in the linked issue as the authoritative delivery receipt. No mail has moved during setup.

## IdP pending grant expiry (September 26, 2026)

[Issue 1394](https://repos.openape.ai/patrick/monorepo/issues/1394).
Worktree `pending-grant-expiry`, branch `bugfix/issue-1394-pending-grant-expiry`, base `531a91ba`.
The production Drizzle store now expires unanswered requests older than 48 hours before reads, decisions and broker capacity checks. Expiry and broker audit records commit atomically. Existing approved and terminal grants retain their statuses.

Permanent SQLite-backed regression coverage extends the existing broker-store suite because the earlier default-store tests missed the production implementation. The original implementation failed 11 new cases; all 344 IdP tests now pass, including the additional decision-boundary case. Full `pnpm lint`, `pnpm typecheck` and `pnpm --filter openape-free-idp build` pass. A separate built-server smoke with the actual production Drizzle plugin, isolated SQLite and SSH challenge authentication verifies the pending inbox, persisted expiry and HTTP 400 for an old approval link; fresh pending and approved grants remain unchanged.

[PR 148](https://repos.openape.ai/patrick/monorepo/pulls/148) passed external CI at `c836ee53`; its main-branch synchronization preserves the parallel Pods entry. Merge, production image, backup, final live verification and issue closure are recorded in the linked issue as the authoritative delivery receipt.

## Pods: central desktop settings (September 26, 2026) — signed evidence; superseded by installed Variant A

[Issue 1393](https://repos.openape.ai/patrick/monorepo/issues/1393),
[PR 146](https://repos.openape.ai/patrick/monorepo/pulls/146),
[PR 147](https://repos.openape.ai/patrick/monorepo/pulls/147),
[inspected sidebar and settings screenshots](https://testrun.openape.ai/r/Z8Rrx-TCsYAZj17DQLcoAjRn).

Both implementation PRs passed exact-head external CI. The active central desktop now shows the DDISA account and App settings at the bottom left. The Pod list scrolls separately. Account access opens account settings; App settings exposes Jev, language, Codex preferences and data/backups. The previous Jev acceptance had covered the alternate local shell instead of this active entry point.

Signed local build: clean merged `7689b6356f8e0190bac7982a22c07569b789792d`, tree identical to tested source `5a46ba7a`. Full `pnpm check:ci`, full lint/typecheck, fresh Pods build, 543 unit/component tests, four focused browser tests and signed mounted-DMG acceptance pass. Permanent tests protect the active navigation, Jev key submission through existing IPC and footer visibility with 30 Pods in English/light and German/narrow/dark layouts. The package smoke runs only synthetic data in an isolated profile; its alternate-shell screenshot is not the central-workspace UI acceptance.

DMG SHA-256: `69b1b6bf1e30a12a2d09086a1654a16a611cc93a7bf75a9a9c02d3fa2cfdcd89`. Apple accepted app `5515b4c8-6bbd-41e8-abc4-db8714e4756a` and DMG `a5eebdcf-96a3-498c-afe1-b2241fa3e95a`; stapling and Gatekeeper checks pass. The ASAR inventory has no owner database/profile/run data. Schema remains 24.

Worktree: `pods-jev-settings`; release artifact: `apps/openape-pods/release/distribution/OpenApe-Pods-0.1.0-arm64-signed-local.dmg`; evidence: `apps/openape-pods/.artifacts/issue-1393-sidebar/`. At this September 26 checkpoint, installation was pending because the owner Mac was locked. This artifact was superseded by the September 28 Variant A installation below; it is not the installed binary.


September 28 closeout: [PR 169](https://repos.openape.ai/patrick/monorepo/pulls/169) is merged. Signed, notarized and stapled build `0.1.0+fbd0188b` is installed in the owner Applications directory. The paired rollback backup and actual owner UI were verified; all 16 Pods, 13 schedule configurations, one workflow and schema 24 were preserved. See the [verified installation report](https://report.openape.ai/r/mNLilvsZA48fCLkTP944g52n). No server deployment is implied.

## Pods: run retention and signed release (September 26, 2026) — installed and verified

[Issue 1391](https://repos.openape.ai/patrick/monorepo/issues/1391),
[issue 1390](https://repos.openape.ai/patrick/monorepo/issues/1390),
[PR 144](https://repos.openape.ai/patrick/monorepo/pulls/144),
[PR 143](https://repos.openape.ai/patrick/monorepo/pulls/143),
[approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3E5TH9XNWQJGJX4NE11PV2W).

PR 144 merged after exact-head CI success (`1856dd99a7e5a51c2fdb06b993c6a3ca456f1026`) at `9237c1966ec8911b907d6d801051c77f52d3c7f8`, which includes PR 143. Main CI also passed. One signed-local DMG was built from the clean merge worktree with frozen dependencies, the full `pnpm check:ci` contract and a fresh Pods build. No relay deployment was required.

DMG SHA-256: `2331cf7b10554ef9324e695d32448eab0a37380bd79fa688335a19d5282b87c8`.

Apple accepted the app (`a451ba7a-d786-4ae3-83cf-75e3439241e1`) and DMG (`e944956e-578b-4230-8129-e11f96ee8c13`); both tickets were stapled and validated. Deep/strict code-sign verification and Gatekeeper passed, including the installed app: `Notarized Developer ID`. The signed DMG acceptance test passed; `.artifacts/data-dmg.png` was visually inspected. Its acceptance Pod existed only in the isolated disposable test profile.

Before signing, the unsigned assembly of the exact build was inspected (2,515 resource entries / 3,214 asar entries). The signed app and read-only mounted DMG were checked again (2,518 / 3,218). No control.sqlite, runs/, pods/, profile or fixture profile data was present. Only OpenApe Pods.app was installed; no Pod, script, schedule or profile was imported or seeded.

The old app quit normally through bundle ID `ai.openape.pods`, with no active run leases. Existing MCP shim processes were left alone. Paired rollback: `/Users/patrickhofmann/Library/Application Support/OpenApe Pods Rollback/2026-09-26-103952-issue-1391` (old 9f00ed4d app moved there plus cp -cR full profile). Backup schema 23, 12 Pods, 2,560 runs and 34,799 run-directory entries were verified; copied database/WAL hashes matched.

| Pod | Runs before | Runs after |
| --- | ---: | ---: |
| Daily action website | 1 | 1 |
| IURIO PR monitor | 177 | 50 |
| IURIO Task monitor | 637 | 51 |
| Mail-Alarm | 0 | 0 |
| Mail-Kurzbericht | 108 | 50 |
| Mail-Wissen · Delta Mind | 0 | 0 |
| Rechnungs-Emails ablegen | 0 | 0 |
| Test | 0 | 0 |
| Timing test · 15-minute no-op | 78 | 50 |
| Timing test · streamlined setup | 1 | 1 |
| zaz Service-Agent | 1553 | 50 |
| zaz Service-Agent · Test | 5 | 5 |

After startup: schema 24; 2,560 → 258 run rows and matching folders; 34,799 → 2,808 entries under runs/. Cleanup journal empty, no orphan/missing run folders, no foreign-key errors and no data_settings.error. The IURIO Task monitor retains one old cancelled run with a still-pending approval, in addition to the newest 50. No eligible old runs remain.

All 12 Pod identities/configuration records and schedule configurations are unchanged. All 26 effect receipts have identical pod/key, operation, input hash, state and result; 18 obsolete run links were detached. Schedule configuration SHA-256: `60e61a6622f02a1356b2759233a3313819c490642b0482032ee702a167ce7288`. Receipt-content SHA-256: `7e2befb39ad86c2f74cf9c97c1f6709050286eb45917d413000cd28a565217a6`.

Live central inventory retains the same 12 Pods, with each history count matching local storage. The removed zaz run `11503fb4-152c-4b9e-9075-2cb2b51bd40f` returns `404 run_not_found`; controller/relay tests additionally verify central archive removal. No new or duplicate Pod was created. Existing blocked Mail-Kurzbericht remains unchanged.

All four enabled schedules completed naturally after startup: zaz Service-Agent at 10:40:23, IURIO Task monitor at 10:42:56, IURIO PR monitor at 10:45:23, Timing test · 15-minute no-op at 10:48:58 (Europe/Vienna). All 14 post-install runs observed through 10:49 completed successfully. No schedule was changed and no manual run was injected.

Worker CPU: NodeService PID 56984, parent app PID 56979; ps time 0:17.25 → 0:22.05, **4.80 CPU seconds over 300.000 wall seconds** after cleanup. Same-session old-app measurement: 10.69 CPU seconds / 300.002 s (PID 24172, parent 24166, 42:07.69 → 42:18.38). Historical owner baseline: 14.5 s / five minutes, then with the IURIO Task monitor running every minute; its current cadence is five minutes. These are operating observations, not a controlled benchmark.

Validation receipts: release `.openape/check-results/1790411276414-9237c196-unit/summary.json`; all 542 Pods unit/component tests; full lint/typecheck/build and normal commit/push hooks. The restart test injects EIO because chmod is not a reliable failure mechanism under root CI. Synthetic cleanup: 2,500 runs / 30,000 files → 50 rows/folders in 98 passes, max 17.42 ms and mean 14.04 ms; idle mean 0.117 ms.

Release worktree: `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo.worktrees/pods-release-1391`. DMG: `apps/openape-pods/release/distribution/OpenApe-Pods-0.1.0-arm64-signed-local.dmg`. Local evidence: `apps/openape-pods/.artifacts/issue-1391/`.

Release evidence branch: `feature/issue-1391-release-evidence` in `pods-run-retention`.
New owner follow-up: [issue 1392](https://repos.openape.ai/patrick/monorepo/issues/1392),
per-Pod opt-in parallel runs, disabled by default. Current runs are already serialized
within each Pod; the existing concurrency limit applies across different Pods.
The new option is not implemented or included in this signed release.

## Pods: repeated timer approvals (September 25, 2026)

[Issue 1389](https://repos.openape.ai/patrick/monorepo/issues/1389).
Worktree `openape-monorepo/openape-timer-investigation`, branch
`bugfix/issue-1389-pods-standing-grant`, canonical base
`a23d519d7543ab572585d9bd6ba141155fcbba19`.
The inbox Always allow action now approves brokered requests with lifetime always,
matching the existing detail page. Ordinary standing-rule and broker policy behavior
remain unchanged. Component coverage exercises both entry points.
Live timer recovery reused the same Pod-scoped always grant on a second no-op run
without a pending approval (two seconds). Full lint/typecheck, IdP application build and 26 focused component/broker tests
pass. Commit/push affected unit gates pass.
[PR 142](https://repos.openape.ai/patrick/monorepo/pulls/142), implementation
`365049fd2ce8bef774f51b177c7126fac44770b1`. September 28 integration preserves
current main and the signed-release closeout from PR 149. The native PR records
the final source, repeated checks and merge result. The inbox change still requires
a separately verified IdP deployment; this merge does not claim a server release.
The historical live timer recovery is already effective.
The integration CI exposed a five-second timeout in the first desktop workflow
component test while it dynamically loaded the desktop module graph. Static
suite imports move module preparation outside the behavioral test; assertions
and the default timeout remain unchanged. The native PR records the failed run
and verification of the corrected test harness.


## Pods: local MCP runtime approval (September 25, 2026) — verified locally

[Issue 1388](https://repos.openape.ai/patrick/monorepo/issues/1388),
[approved implementation plan](../../.claude/plans/issue-1388-mcp-runtime-approval.md).
Worktree `pods-mcp-runtime-approval`, branch `feature/issue-1388-mcp-runtime-approval`,
canonical base `98cf9078600f5ec94585294772db78cdd7c8cf81`.
Desktop-only opt-in approves the exact reusable runtime grant for locally MCP-created
Pods, through their original owner and decision IdP. Denial/revocation, signed grant
verification and separate resource permissions remain enforced. Disabling prevents
new automatic decisions; existing grants require explicit revocation.
Full lint/typecheck, Pods build, 515 unit/component tests and two real Chrome settings
tests pass. English/light and German/narrow/dark screenshots were inspected; the
self-contained local report is `apps/openape-pods/.artifacts/runtime-approval-report.html`.
[PR 140](https://repos.openape.ai/patrick/monorepo/pulls/140), implementation commit
`a610cc9ce1fef75375347e6af38da346b01fceae`. Commit/push affected unit gates pass,
including the relay consumer; receipt `.openape/check-results/1790346471069-a610cc9c-unit/summary.json`.
Next: exact-head external CI and owner review; installation is separate. No owner-profile changes.

## Pods: TypeSafe Jev integration (September 25, 2026) — implementation verified

[Issue 1385](https://repos.openape.ai/patrick/monorepo/issues/1385),
[review plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3C2TZC7HM94KDEG7AWW3BGM),
[local plan](../../.claude/plans/jev-integration.md).
Worktree `jev-integration`, branch `feature/issue-1385-jev-integration`,
integrated canonical base `63ab0bf0788e02dfd5c6fd8f5f7936977cfbbe6f`.
Encrypted TypeSafe account setup, per-Pod inference permissions, bounded Jev runtime,
MCP discovery, native/central UI and handbook are implemented. Full lint/typecheck,
Pods build, 492 unit/component tests, 22 browser tests and 11 native script tests pass.
Real API model discovery and all three decision types passed with `jev-1.13.0`.
The existing owner-authorized key is encrypted in the isolated Jev development profile;
production accounts, Pods and schedules were not changed. Remaining acceptance:
neutral fresh Codex authoring plus live Pod grant flow and labelled workflow quality.
[PR #134](https://repos.openape.ai/patrick/monorepo/pulls/134), implementation commit
`fa31c9bc684ed02b6c23a5f2d762eba62daf961a` against the base above.
[Published evidence](https://testrun.openape.ai/r/q8kG0M6twEJoIpqcVVx8reEg).
Commit/push hooks passed the affected unit contract, including the relay consumer.
The original head `9f3ee934` passed external CI. Owner UI correction: compact API-key form directly in App settings, no Jev explanation/link or Script/Permissions panels. Agent reference and resources API remain authoritative. Full lint/typecheck, build, 34 focused tests and five browser tests pass; [updated screenshots](https://testrun.openape.ai/r/sDUdikwIBcms_bwtddTTcAJG). Next: push the UI correction and check its exact head before PR review; no production release in this task.

## Pods: stable central connection (September 25, 2026) — deployed

[Issue 1384](https://repos.openape.ai/patrick/monorepo/issues/1384),
[approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3C2RQPRQ5HE2XBRFXR8KRM5).
PR 132 (`63ab0bf0`), follow-ups PR 133 (`dea37661`, idle storage rewrite) and PR 135 (`3c9afa24`, bounded scheduler tick), all exact-source CI green.
Relay `prod-63ab0bf0`; signed desktop `3c9afa24` (DMG sha256 `33a46975…`) installed 15:15.
Backups: relay `shared/backups/issue-1384-before-20260925T112651Z`; desktop
`~/Library/Application Support/OpenApe Pods Rollback/2026-09-25-151456-issue-1384-final`.
5 min nettop on the main process: 132.7 MB in / 63.3 MB out before, 0.74 MB / 0.64 MB after.
Measurements, incidents and lessons: PR 132 comment. Open follow-ups: storage inspection walks ~24 000 files every 5 s ([issue 1387](https://repos.openape.ai/patrick/monorepo/issues/1387): full inventory every 60 s plus a per-tick disk/limit/error check, PR 139; signed desktop `9f00ed4d` (DMG sha256 `8aa0b77a…`) installed 17:10, backup `OpenApe Pods Rollback/2026-09-25-171031-issue-1387`; worker CPU over 5 min went from 51.2 s to 14.5 s; native acceptance needs the display awake);
`query` before the first lease answers 400 instead of "connecting".

## Pods MCP discovery texts (September 25, 2026)

[Issue 1383](https://repos.openape.ai/patrick/monorepo/issues/1383). Worktree `pods-mcp-discovery`,
branch `feature/issue-1383-mcp-discovery`, base `3ff707b6`.
- Server instructions now carry the discovery signal (category, when to use, capabilities, order, stale-session hint) in 1 188 characters.
- `pods_control` describes only what it does and returns.
- `serverInfo` and the tool report title `OpenApe Pods`; `serverInfo` reports version `<app version>+<build revision>`.
- Follows [Claude Code tool-search guidance](https://code.claude.com/docs/en/mcp#for-mcp-server-authors) (2 048-character limit).

The change reaches installed apps with the next signed release. Splitting read/write tools with annotations remains an owner decision.

## Pods: service-queue pattern in runtime help (September 25, 2026)

[Issue 1382](https://repos.openape.ai/patrick/monorepo/issues/1382). Worktree `pods-service-pattern`,
branch `feature/issue-1382-service-pod-pattern`, base `6c72f271`. The MCP `runtime` help
gains `patterns.serviceQueue`, the verified issue-1381 pattern: setup, rules and a tested
example script. It reaches installed apps with the next signed release. A dedicated skill is
deferred until a second or third service Pod exists.

## Pods: zaz task queue from a scheduled Pod (September 25, 2026) — delivered

[Issue 1381](https://repos.openape.ai/patrick/monorepo/issues/1381),
[plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3AMN0CXG8G9TH0FR3MX5K5J).
PR 127 merged as `7103930d`; PR 128 merged as `7a269851` (external CI 5100 and the review-fix run, both green).
The runtime changes:
- HTTP resources authenticate as a DDISA agent from an assigned key secret; the key is not readable by scripts and echoed tokens are redacted.
- `receipt: "digest"` stores digest-only receipts, and oversized effect replies do so automatically.
- Request bodies up to 64 KiB, responses up to 128 KiB.
- `agent.run` accepts `timeoutSeconds` up to 900; the agent budget pause is capped per run.

The signed and notarized `7a269851` package (DMG sha256 `01e2558e…`) passed the mounted-DMG check and is installed and open.
Paired rollback: `~/Library/Application Support/OpenApe Pods Rollback/2026-09-25-000406-issue-1381`.
The IURIO monitor kept its 900 s schedule (rev 2) and its five receipts.

zaz (`delta-mind/zaz` PR 4 into deployed `feature/monatssoll`, release `2026-09-24T21-31-33`) adds authenticated
`GET /api/agent/tasks/pending` and compact resolve replies.

The zaz Pod `93139662-c618-48e2-8a1e-36299aff36f2` is active on a 60 s interval. It uses gpt-5.5 via `agent.run` and the
`op-delta-mind` agent key (secret `zaz_agent_key`). Test Pod `e8062ed3-22a0-40f9-8f88-c2c239129331` stays paused without a schedule.

Acceptance:
- An empty queue makes one GET and zero model calls or receipts.
- Controlled tasks `d03d0a34` (manual) and `7c47a133` (scheduled run `19db9941`) completed once with one artifact each.
- An intentional resolve replay returned the stored digest receipt.
- Repeat runs added no effects.
- Central inventory shows both Pods, their runs and the schedule.

The legacy launchd worker stays disabled.

## Pods: Claude Code MCP integration (September 24, 2026) — implementing

[Issue 1380](https://repos.openape.ai/patrick/monorepo/issues/1380),
[review plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3AJBBZHMJV6KC8A4WJP67JR),
[local plan](../../.claude/plans/issue-1380-claude-code.html).
Worktree `pods-claude-code`, branch `feature/issue-1380-claude-code`, canonical
base `967038a5bff24a24b96e020f788b4060b1243c31`.

Code inspection selects the existing STDIO MCP and CentralController query
contract. Existing MCP lacks central online inventory and full run results;
its transport generates a fresh request identity on every call. The planned
adapter reuses central inventory/read/submit/operation and durable command IDs.
Claude Code 2.1.260 successfully connected to the actual installed launcher in
an isolated `/tmp/pods-claude-handshake.MicvlS` configuration (`mcp get`:
`Status: Connected`). The owner Claude user configuration now contains only the added MCP entry and
exact tool allow rule; unrelated configuration was compared and preserved.
No owner Pod state was changed.

Patrick approved the plan and brief backed-up app update/restart with “Los geht’s”.
The shared central MCP adapter is implemented. Full lint/typecheck, app build,
22 focused unit checks and the packaged MCP transport check pass. Receipts:
`/tmp/pods-claude-{lint,typecheck,build,focused,packaged-mcp}.log`.
Next: exact-source PR checks/merge, signed installation and live Claude acceptance. Keep the installed app open and the IURIO monitor untouched.
Use a separate synthetic Pod for acceptance. Automatic E2E/layout remains off.

## Automatic CI scope (September 24, 2026)

[Issue 1379](https://repos.openape.ai/patrick/monorepo/issues/1379), branch
`bugfix/issue-1379-headless-ci`, worktree `pods-web-workspace`, base canonical
main `f576ea94bb746f6e811b45a8dce8f9128d5fc40d`.
Owner decision: remove all automatic E2E/layout jobs and required contexts;
retain audit, tooling, lint, typecheck and unit/component checks. Explicit
manual E2E/layout commands remain available. Three main-CI unit timeouts in
Pods bulk fixtures are addressed with transactions around seed data only;
assertions, deadlines and production durability remain unchanged. Exact-source
verification, audited protection migration and merge receipts belong to the
issue. The deployed Pods app and monitor remain running; no runtime changes.

## Pods: central browser and desktop workspace (September 24, 2026) — deployed

[Issue 1378](https://repos.openape.ai/patrick/monorepo/issues/1378),
[approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3A03YDYB092Z1NDM7J6NQ8X),
[local plan](../../.claude/plans/2026-09-24-pods-central-workspace.html),
[live acceptance evidence](https://testrun.openape.ai/r/bPb4nyghS79Z5iXMo5m3_ZGZ).
Worktree `pods-web-workspace`; documentation branch
`feature/issue-1378-live-closeout`, base canonical main
`f576ea94bb746f6e811b45a8dce8f9128d5fc40d`.

Delivered through PRs 120–124: owner-scoped central SQLite data and managed
artifacts, versioned commands/receipts, one browser/desktop Vue workspace,
online-only content/editing, durable runtime recovery and connected Codex on
the same writer. Secrets, private keys and native login state remain local.
Embedded chat remains removed; relocation remains excluded.
[Operations and recovery](../operations/pods-central-workspace.md).

The final reviewed PR 124 source `67c10b97001126e48d7fd1d6243412b3d2a74286`
passed exact-source external CI 5085, E2E 5086 and layout 5087 against target
`14ec37bc857a1ce8237ccbd81566a61d2a8fed22`, then merged as `f576ea94`.
Full clean local deployment contract passed in `1790277270233-67c10b97-all`:
451 Pods unit/component tests, native/packaged checks, browser layouts and real
DDISA HTTP acceptance. The previous main `14ec37bc` passed jobs 5082–5084.
Final post-merge main results are recorded on the issue; documentation does not
change the accepted runtime tree.

Production workspace image `prod-f576ea94` passed its tested-image deployment
and health gate. Provider health, discovery and JWKS are byte-identical to the
pre-deployment baseline. Signed/notarized desktop source `67c10b97` passed
mounted-DMG acceptance, is installed and remains open. The owner signed in through
the existing SSH flow. All six Pods were adopted through the verified owner;
IDs, lifecycle states, schedules, baseline and effect receipts are preserved.

Live acceptance verified browser-to-desktop editing and desktop-to-browser
restoration without reload or reselection. The original test description is
restored. All accepted operations are applied, with no unresolved journals.
Offline inventory remains visible while content and controls are unavailable;
ordinary Mac launches retain central authority. Live testing found and fixed
Nitro's idle HTTP 204 response (PR 123) and stale untouched editor fields
(PR 124), each with retained behavioral regressions. Dirty edits remain protected.

IURIO Pod `98c32f74-ffaf-4628-bd41-95cea821572f` remains active with its enabled
900-second schedule at revision 2. Supported recovery and four natural runs after
adoption completed without duplicate Telegram messages. Latest verified run
`9713d194-e711-451b-9db5-6b55a654e5f9` reports no PR changes/no Telegram;
checkpoint 32 and all five existing completed effect receipts are retained.
The installed app stays open on its monitor overview. No further rollout action
is required; preserve normal scheduled execution.

Receipts: `~/Downloads/OpenApe-Pods-live-20260924/verification.html` and `final/`.
Latest paired app/profile backup:
`~/Library/Application Support/OpenApe Pods Rollback/2026-09-24-213618-issue-1378-editor`.
Latest server online SQLite backup:
`shared/backups/issue-1378-editor-20260924T192205Z` in the relay service.
Do not restore an older profile over newer central writes or effect receipts.

## Pods: connected Codex owner administration (September 24, 2026) — delivered

[Issue 1377](https://repos.openape.ai/patrick/monorepo/issues/1377), [approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3971H91PDY5XPHJP3696PZ7). Worktree `issue-1377-broker-capacity`; completion documentation branch `bugfix/issue-1377-completion-docs`.

Delivered: PR 113 (`56eb0366`) removed embedded chat and duplicate local approvals; PR 115 (`b17e2b54`) removed per-script secret selection and documented MCP CLI setup. PR 116 (`4f5977cb`) added explicit native CLI runtimes and corrected active-operation checks for consumed one-shot grants. PR 117 (`8af87e34`) makes current owner-assigned grants take precedence over stale run history. PR 118 (`8ac60bf0`) applies configured machine capacity to broker assertions. All exact-source CI/E2E/layout checks passed; full local checks passed before distribution and deployment.

Signed/notarized desktop source `347b869d` is installed and its mounted-DMG check passed. All six Pods and real Codex settings were preserved. Receipts: `~/Downloads/OpenApe-Pods-347b869d/`; paired app/profile rollback: `~/Library/Application Support/OpenApe Pods Rollback/2026-09-24-160638-issue-1377`. The formerly failing current Azure grant completed successfully in real run `b9a9627a-cb89-43e0-986b-b88bef5478ee`.

Owner IdP `prod-8ac60bf0` and Pods provider `prod-4f5977cb` are healthy with unchanged discovery/JWKS. Both machine limits are configured to 600; strict login limits are unchanged. The broker's previous independent 120-assertion bound caused the real HTTP 429 failures. Azure read and Pod runtime already use approved `always` grants; repeated status/token checks are not new approval requests. Owner IdP database backup passed SQLite quick_check at `/home/openape/projects/openape-free-idp/shared/backups/issue-1377-capacity-20260924T140829Z`; environment backups are under each service's `shared/backups/issue-1377-rate-20260924T135931Z`.

Reuse group `iurio` and Pod `98c32f74-ffaf-4628-bd41-95cea821572f`. Private Azure login and real PR reads are verified; no repeat login or PAT is needed. Telegram connection test `a2e8104b-07e2-40ca-8a4c-7430596fc6dd` completed and Patrick confirmed receipt. Full run `368a4b8e-6320-445e-a841-a7eb352549f5` completed all 39 PRs with 119 successful Azure reads and one confirmed Telegram baseline notification. Bounded retries cover transient read failures while preserving the prior baseline on failure. Follow-up `88c09e14-5ff2-49f8-8550-816dc31af162` completed another 119 reads with no changes and no Telegram message. The Pod is active with its 900-second schedule enabled at revision 2; checkpoint revision 10. Other Pods are unchanged. Receipts are recorded in `~/Downloads/IURIO-PR-monitor/TASK.md` and the issue. Never copy owner login stores or expose secret values.

## Pods installed Codex MCP dependency (September 24, 2026)

[Issue 1376](https://repos.openape.ai/patrick/monorepo/issues/1376). The signed `95fc9d87` installation exposed an external `croner` import in the unpacked MCP runtime; checkout-based acceptance resolved ancestor dependencies and missed it. The repair bundles the dependency and runs the existing packaged MCP case from an isolated path outside the checkout. That regression fails with the installed error before the fix and passes after it; full lint/typecheck and the app build pass. The issue records exact-source merge checks and refreshed signed installation evidence. Preserve the owner app/profile rollback pair.

## Pods: Codex controls the installed app (September 23, 2026) — done

[Issue 1375](https://repos.openape.ai/patrick/monorepo/issues/1375), [plan](../../.claude/plans/issue-1375-codex-control.md) (D1–D6 and option a approved by Patrick). Issue closed. PR 108 (adapter), PR 109 (MCP shim and launcher) and PR 110 (registration UI, **Prepared by Codex**, handbook chapter and packaged acceptance with a real `codex app-server`) are merged; PR 110 merged as `8aad8901`. The owner's real `~/.codex` and profile were never touched; all tests use isolated `CODEX_HOME` and fixture profiles. Installing on Patrick's Mac and connecting his Codex are his own steps in App settings.

## Pods test pyramid (September 23, 2026) — done

[Issue 1374](https://repos.openape.ai/patrick/monorepo/issues/1374), [plan](../../.claude/plans/issue-1374-test-pyramid-pods.md) with outcomes. PR 97–104 merged (main `94ca3550`), no production code changes. Pods E2E: 35 files / 135 tests / 72.6 s → 25 files / 109 tests / 27.9 s (CI, 6 workers); pods layout step 54.2 s. iOS client outside the check contract (PR 100, issue 1364). Which level proves what: `apps/openape-pods/docs/testing.md`. Issue closed. Follow-up PR 106 merged as `3cc7104e` (packaged E2E variants only, a leaner browser matrix and `pnpm --filter @openape/pods test:fast`, about 14 seconds without Electron). PR 107 merged as `b2b7002e` (pre-push runs only `check:affected --suite unit`; E2E and layout run externally once per head).

## Pods: two owner accounts (September 22, 2026)

[Issue 1372](https://repos.openape.ai/patrick/monorepo/issues/1372) (supersedes 1365). Worktree `wt-issue-1372`, branch `feature/issue-1372-two-owner-accounts`, base `b15b564a`. [Plan](../../.claude/plans/issue-1372-two-owner-accounts.md), approved by Patrick with D1 (Pods of another identity are re-provisioned under the owner), D2 (one-time Pods provider consent at the first Pod) and D3 (one email field, IdP from the DDISA DNS record).
"Your accounts" shows exactly Codex / GPT and the DDISA owner. Startup reconciliation keeps one row per provider, merges duplicate rows of the owner identity without re-provisioning and releases bindings of other identities. Mobile access and new Pods use the owner implicitly. Native [PR 96](https://repos.openape.ai/patrick/monorepo/pulls/96). Local evidence: 362 Pods unit/component tests, 8 packaged Electron onboarding/handbook E2E tests, lint and typecheck green. Installation on Patrick's Mac is a separate decision.

## Native mobile Pods (September 21, 2026)

[Issue 1362](https://repos.openape.ai/patrick/monorepo/issues/1362), [approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2ZQTVS90HK79ZWQW973Y8HP).
Installed desktop (October 6, 12:30 CEST): signed-local 0.1.2 from clean main `288918f9e340609325384af5733a451bc8a2fc24` (DMG SHA256 `a0a7f4d78e52f92efca07513807764c2d9d0cf033c1603ecf7bf2670ad6ea1b6`), notarized and stapled, mounted synthetic acceptance passed (`pnpm test:distribution --signed-local`), installed bundle byte-identical to the DMG, Gatekeeper `Notarized Developer ID`, schema 38 unchanged. Paired rollback: `/Users/patrickhofmann/Library/Application Support/OpenApe Pods Rollback/20261006-native-mobile-1362` (previous app and profile copy). The previous GUI had already quit; the 21 remaining `codex-mcp.mjs` processes of agent sessions kept the old bundle through a move instead of a delete. Relay stays `prod-42541063`.
Patrick authorized end-to-end implementation; work resumed in Claude Code from the September 20 handoff. All six milestones have their synthetic-stack implementation on main (October 6). Owner decision October 6: Apple distribution and physical-device acceptance are deferred out of this plan; the remainder is listed in `docs/operations/pods-mobile-release.md`. The plan is closed as complete for its implementable scope; M1 keeps its owner-blocked gaps.

Foundation [PR 80](https://repos.openape.ai/patrick/monorepo/pulls/80) is merged as `131874cdd1a2ad8b4488e63ef6ca8356ea7cfdc0`. The relay packaging repair merged through [PR 82](https://repos.openape.ai/patrick/monorepo/pulls/82) as `8441c325e35fbda3bad43f5cf9ecfa6aa9e40df8` (external 4809/4810/4811 green; PR 81 is superseded and should be closed). `pnpm deploy:image pods-relay` from that clean main deployed `prod-8441c325` disabled: container 999:988, read-only root, `enabled: false`, provider discovery/JWKS/health byte-identical, reviewed Traefik router installed, stale `prod-131874cd` pin removed with backup. Verification policy decision: [issue 1363](https://repos.openape.ai/patrick/monorepo/issues/1363) / [PR 83](https://repos.openape.ai/patrick/monorepo/pulls/83) (affected pre-push, one external full contract, hidden fixture windows).

Native acceptance [PR 84](https://repos.openape.ai/patrick/monorepo/pulls/84) merged as `b4cff75b8a4cc1043872fef275f7e587825d8772` (source `e04cf8462c0e44c5aed1ff37182e17f476176fa8`, external 4821/4822/4823 green). Its push gate `1789985301982-e04cf846-all` ran every workspace including the native run from clean source; iPhone and iPad passed 2/2 with app restart, desktop restart and pairing removal (refused, no new run). Published evidence: https://testrun.openape.ai/r/aUeVd1ZWv-LKtO4bMdIadQxQ. Remaining M1 gaps: two distinct real broker/decision authorities in the native fixture (owner decision on a fixture-only loopback boundary), controlled live-model smoke (owner ChatGPT sign-in), physical-device HTTPS association.

Test-pyramid steps 1–3 are merged (PR 85 `80d62c57`, PR 86 `96b39096`). M2 (delivery, recovery, shared editing): [PR 87](https://repos.openape.ai/patrick/monorepo/pulls/87) (merge `e4499574`) and [PR 88](https://repos.openape.ai/patrick/monorepo/pulls/88) (merge `1f08c9ce`) deliver generation rotation after restore (unit + real-stack round trip), relay-reported pairing state, Retry-After, socket replacement/expiry/revocation, interrupted commands staying `unknown`, stale run refusal, per-runtime replay bounds and idempotent claims. Next: program-effect replay proof, review-conflict UI, native `RelayClient` tests with injected Keychain/URLSession, then the M2 acceptance run on the integrated stack before M3. Owner-blocked M1 gaps remain: two real authorities in the native fixture, live-model smoke, physical-device association.

M2 change sets merged September 22: [PR 90](https://repos.openape.ai/patrick/monorepo/pulls/90) (`520da61a`, program effects never replayed remotely), [PR 91](https://repos.openape.ai/patrick/monorepo/pulls/91) (`b15b564a`, desktop edits during a mobile approval become a `revision_conflict` re-review), [PR 93](https://repos.openape.ai/patrick/monorepo/pulls/93) and [PR 94](https://repos.openape.ai/patrick/monorepo/pulls/94) (`71bf5805`, native `RelayClient` tests with injected secrets and transport). Patrick's first phone test against relay `prod-b15b564a` created and chatted with a Pod from the iPhone; findings are issues 1366–1369 and 1371. The installed desktop is a notarized signed-local build. Since September 23/24 the native iOS client is outside the automatic check contract (issue 1364, PR 100) and only unit CI is automatic (issue 1379, PR 126); the native run is `pnpm --filter @openape/pods-ios test:layout` on demand.

M2 acceptance (October 6, 2026): [PR 248](https://repos.openape.ai/patrick/monorepo/pulls/248) rebases the acceptance harness onto main `79dc50d2`. The native run proves the four interruption cases (disconnect before admission, before result acknowledgement, desktop crash after run reservation, desktop crash after journal commit) on iPhone and iPad; the first run on today's main failed only at a fixture selector left behind by the Variant A workspace and was corrected without assertion changes. Evidence: https://report.openape.ai/r/Qi8c8RSCwz4wFT0vcjSzdjlr. Local checks on the head: affected lint/typecheck 18/18, 1358 Pods tests, 35 relay tests, 13 Swift tests. The production dependency audit fails on main itself since 2026-10-05 advisories and needs an owner decision. The required `CI / ci (push)` failed on main's own lockfile at `pnpm audit --prod --audit-level=high` (nine advisories published 2026-10-05). Patrick decided: update where a patched release exists, exception only where none can be installed. [Issue 1428](https://repos.openape.ai/patrick/monorepo/issues/1428) / [PR 249](https://repos.openape.ai/patrick/monorepo/pulls/249) resolve seven advisories through overrides and document the four simple-git exceptions (simple-git 4 breaks every @nuxt/devtools 3.x). PR 249 merged as `0669c2141c470e58fad178fb492499d296e40619`; PR 248 merged as `0811be72777e594b304e405ae29be484de589f83` on Patrick's instruction. M3 (October 6): a gap analysis found envelope encryption, `encryption_required` negotiation, key epochs, relay retention and the protected native cache already delivered in M1/M2. [PR 251](https://repos.openape.ai/patrick/monorepo/pulls/251) (merge `ef0968fd`) adds the per-party visibility table and threat review in `docs/architecture/pods-mobile-protocol.md`, the desktop and native disclosures (including that content shown on a revoked device cannot be recalled), a relay storage proof (no readable content in the SQLite file or audit table) and a key-epoch refusal test. Owner-gated remainder: physical iPhone/iPad sign-in, lock/unlock, logout and offline cached-read checks with a new build, and the desktop build rollout. M4 (October 6): [PR 253](https://repos.openape.ai/patrick/monorepo/pulls/253) (merge `a99aec4475ba5e31e1e41c583cbeaffd6d4db976`) adds the explicit desktop handoff (issue 1368), older-message paging through the existing `nextBefore` cursor, the chat scroll anchor (issue 1366) and desktop-matching collapsed resolved reviews (issue 1367); native suite green on both simulators, [evidence](https://report.openape.ai/r/rzvKlM2PWYxmh7s6A5rl05NZ). Typed remote reviews for HTTP/program/dependency permissions wait for desktop parity. M5/M6 (October 6): [PR 255](https://repos.openape.ai/patrick/monorepo/pulls/255) (merge `5096bfce`) adds opt-in content-free APNs (relay token store, notifier with mocked-transport tests, native toggle and coordinator, disabled by default), the TestFlight archive/export script with tester checklist, and the M6 readiness record `docs/operations/pods-mobile-release.md` (compatibility/rollback matrix, limits, privacy and export facts, App Review notes, owner actions). Native regression green on both simulators, [evidence](https://report.openape.ai/r/Z3_35HZpldKTnGCwycEhOU2e). Owner/Apple remainder: App Store Connect record and capabilities, APNs key via secrets.openape.ai, TestFlight upload and Beta App Review, physical-device delivery and network tests, privacy/support pages, export declaration, App Review outcome. Owner-blocked M1 gaps remain: two real authorities in the native fixture, live-model smoke, physical-device association (partly exercised by the phone test). Chat fixes for 1366/1367 wait in `pods-mobile-scroll` for the 1367 owner decision.

## Central Pod chats (September 20, 2026)

Follow-up: Patrick requested model selection at the composer through `/` and
`/model`, following the [official Codex command pattern](https://learn.chatgpt.com/docs/reference/slash-commands).
The existing model catalogue and saved preference now use one searchable picker,
also opened by the compact model button beside +. Commands stay local, selection
preserves surrounding draft text, and running responses lock model changes.
The integrated base is `403ecf68` (PR 79); both concurrent work records are retained.
Previous source `a704411473bc8635746ad3df9c86f09b05538e7f` passed all local and
external gates. Follow-up checks and inspected UI evidence belong to PR 78's
exact-source acceptance record; these previous results do not certify a new head.

Issue: https://repos.openape.ai/patrick/monorepo/issues/1359. Native [PR 78](https://repos.openape.ai/patrick/monorepo/pulls/78). Worktree
`pods-central-chats`, branch `feature/issue-1359-central-chats`, canonical base
`934dbcec21cce8e3620ecda51a77aa8458bcfd30` (rechecked during implementation).
[Approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2ZACGJKS6JHH84T22Q48K49).
Chats is a sibling sidebar destination. The composer + selects explicit Pods
and one pinned workflow; context changes preserve history and start a fresh
provider session. Schema 21 retains legacy conversations and historical Pod
links. Reviewed local changes apply atomically, runs require a separate owner
action and retain actual run IDs. [Contracts](../../apps/openape-pods/docs/chats.md).

The shared coordinator is `worker/control/changes.ts` over existing domain
operations, with `contracts/control-api.ts` and authenticated owner-window IPC.
The separately planned MCP adapter must reuse this writer and existing native
approval surfaces; no MCP transport is introduced here. Saved Pod draft artifacts
remain available to selected chats; conversation text, composers and pending
change sets are separate. Stale changes require discard and deliberate preparation.

Implementation checkpoint `7540e3cc35932ba26c7a6a27af3d1ef4a6e25519` passed the
complete `pnpm check:ci` contract: full lint/typecheck, unit, web E2E and layout,
including 334 Pods unit/component and all 135 native tests with no skips.
Local summary: `.openape/check-results/1789910155897-7540e3cc-all/summary.json`.
[Inspected packaged UI](https://testrun.openape.ai/r/3Z4ctc_EDtxDgykTyQ2ckcKO)
covers + context selection, coordinated review and 1060/760/560 px layouts.
The existing self-contained HTML pipeline includes these screenshots.

Two existing native startup polls required an explicit 10-second readiness
window; functional assertions remain intact. An unrelated Git login-layout
check timed out once, then passed both its isolated run and complete unchanged
retry. Canonical main advanced during handoff to
`78fad3f1be6c3d67f2f68c50c8b142a0e9a06bb3` (PR 77, including real callback coverage
for that login path); it was integrated without conflicts or Pods code changes.
The combined final source must pass the same complete contract before push.
Final source/target SHAs, native diff review and external-check status belong to
the PR acceptance record. Next: review PR 78 after those exact-source checks;
merge, installation and live acceptance are separate decisions. No installed app,
owner profile, live mailbox, Telegram message or schedule activation was changed.
Troop/OpenClaw remains paused.

## Native issue pilot live (September 20, 2026)

[Issue 1356](https://repos.openape.ai/patrick/monorepo/issues/1356) now lives in the native forge. [PR 77](https://repos.openape.ai/patrick/monorepo/pulls/77), reviewed source `6b64f9ded062cc7e281117504fdc88e4b0f130cd` and target `934dbcec21cce8e3620ecda51a77aa8458bcfd30`, merged as `78fad3f1be6c3d67f2f68c50c8b142a0e9a06bb3` after all 17 local gates and exact-source external CI/e2e/layout passed. The approved private pilot activated at 13:36:53 UTC; Forgejo is now its read-only issue archive and unchanged Git/CI mirror.

The final import reconciled 233 issues, 175 comments, 15 labels, three attachment byte streams and 37 history rows. Nineteen unresolved assignments retain provenance without native permissions. All 110 inventoried Tasks/Plans/PR links resolve; actual DDISA login retains old comment anchors. Private intake and 17 product routes are active. Synthetic live acceptance records 1360/1361 are closed; tracking issue 1356 remains open through observation. Off-site snapshot `0cc0862b` independently restored 235 issues, 423 origins, 411 legacy links, all assets/archives and a Git clone. [Operational receipt](../operations/native-issues-migration.md#production-pilot-september-20-2026).

Closeout checkout: `native-issues-cutover`, branch `feature/issue-1356-native-issues-authority`, base `78fad3f1`. This change switches current guidance and CLI issue entry points, documents the bounded worker handoff and preserves original SQLite errors after automatic rollback. Eight retained operator contracts pass; full final-head gates and native PR review remain required. The extra rollback regression covers the observed production failure, atomicity and retry, rather than an implementation detail. Thirteen web app image deployments are healthy. Next: final closeout review, Docs entry point, guarded central configuration update and seven-day observation through September 27. Do not resume excluded workers, change installed Pods profiles or claim external-repository/public rollout completion.

Earlier entries below are dated implementation checkpoints; this receipt supersedes their monorepo issue authority statements.

## Pod workflow graphs and conservative mail filtering (September 20, 2026)

Issue: https://git.openape.ai/openape-ai/openape/issues/1358. Native [PR 76](https://repos.openape.ai/patrick/monorepo/pulls/76). Worktree
`pods-conversation`, branch `feature/issue-1358-pod-workflow-graphs`, canonical
base `77c6b22aa959b60402a22e4cc34700f74ebe8d47`.
[Approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2YXXAP6HC15CBQR5DV8XVHM).
Implemented first-class workflow graphs, independent schedules, atomic reservations,
immutable handoff/recovery, protected mail partners, frozen batches and durable
move/Telegram reconciliation. [Execution contract and disabled pilot](../../apps/openape-pods/docs/workflows.md).
Companion [CLI PR 8](https://git.openape.ai/delta-mind/o365-cli/pulls/8), source
`6617d2a6f14aa4d3df5eef2b1621eaf9ccbba05b`; vet/build/race tests pass.
Production autonomous archive remains blocked: Graph does not document the
required atomic conditional-move guarantee. Controlled transports prove local
recovery only. Restored mail scopes require a new quiet-baseline workflow.

Implementation commit: `2bfbdc34e649fb8ea8f5477a625c1a34417c6bc6`.
Reviewed native PR target: `77c6b22aa959b60402a22e4cc34700f74ebe8d47`;
the complete 79-file diff was available without truncation.
Full repository lint/typecheck, 312 Pods unit/component tests and app build pass.
Full `pnpm check:ci` passes on that commit, including all 134 native Pods tests:
`.openape/check-results/1789900150785-2bfbdc34-all/summary.json`.
[Inspected checkpoint report](https://testrun.openape.ai/r/r9EqNUJHuw5V-JIGRha12EAV).
The compact graph follow-up wraps at 760 px and asserts every node fits the
visible content width. Final source/target SHAs, complete gate results and the
latest visual evidence are recorded in PR 76's acceptance comment.
External forge checks are separate from this local evidence; do not merge until
they match the final source and succeed. Next: owner review of PR 76 and CLI PR 8;
then separate pilot setup and provider-concurrency decisions.
The concrete local review draft is
`apps/openape-pods/.artifacts/mail-workflow-pilot.json`; no Pod/application IDs
are invented and no protected partner or archive rule is silently approved.
No live profile, mailbox, Telegram delivery or schedule activation was changed.
The retired Troop/OpenClaw mail automation remains paused; its `kpi-mail` schedule
was read-only verified `enabled=false` at 2026-09-20T10:34:09Z.

## Pods user guide (September 20, 2026)

Issue: https://git.openape.ai/openape-ai/openape/issues/1357. Native [PR 75](https://repos.openape.ai/patrick/monorepo/pulls/75). Worktree
`openape-monorepo.worktrees/pods-user-guide`, branch
`feature/issue-1357-pods-user-guide`, canonical base
`cf19d3773f45dc9a5d8cd0cc8099fb5a76134cc0` (merged PR 74). Implementation
checkpoint: `e55edc4d98123a732c500fca61f25003448849c9`. [Inspected visual
evidence](https://testrun.openape.ai/r/TzIMdYOoh7dD-x10bUpV2Kfc).

The Apps generator now includes `/apps/pods` from the same English handbook
source and section renderer as the offline edition. Both English and German
handbooks explain current accounts/provider consent, saved chat setup, access,
manual verification, schedule catch-up, revocation and recovery. The internal
notarized build is explicitly not a public release. Twelve native screenshots
per language come from an isolated fixture without service calls or execution.

Verification: full lint (51 tasks), typecheck (72 tasks), Pods build and fixture
package, Docs build (179 prerendered routes), two generator contracts, two offline
browser cases and twelve scheduler tests passed. The affected unit contract
passed at `.openape/check-results/1789883759993-cf19d377-unit/summary.json`.
Desktop 1440px and narrow 390/560px renders, guide images, Apps navigation and
internal links were inspected. Raw browser evidence is in
`.openape/check-results/pods-guide/`; no full local E2E suite was run.

Next: native PR review and exact-source external CI/E2E/layout gates, then deploy
only Docs from clean canonical main using `pnpm run deploy:docs-site`. Record the
PR, reviewed source/target, final evidence and deployment result in its timeline.
Existing owner app/data/accounts and schedules remain untouched.

## Provider consent wording (September 19, 2026)

Issue: https://git.openape.ai/openape-ai/openape/issues/1354. Native [PR 74](https://repos.openape.ai/patrick/monorepo/pulls/74); worktree `pods-conversation`, branch `bugfix/issue-1354-provider-consent-wording`, implementation checkpoint `a79c94425e00d6f059eca56847b3a3cae6468b51`, canonical base `d5aa59c1a6df11189274ada1690b52f176899c4c`.

The provider action now says **Allow requests from this provider** and explains that consent uses the existing DDISA account without another provider sign-in. Confirmation/revocation, German translations and the operator workflow use permission terminology. Full lint/typecheck, app build, 267 unit/component tests and the single focused packaged provider-settings case pass; [inspected English/German and narrow dark evidence](https://testrun.openape.ai/r/FzY7KuWo0P6GAiNJnnni5VLD). No full local E2E suite or live provider test calls. Next: exact-source native review/checks, merge, notarized internal package and paired app/profile installation. The linked PR's delivery comment records final SHAs and preservation receipts.

## Personal accounts and per-Pod identities (September 19, 2026)

Issue: https://git.openape.ai/openape-ai/openape/issues/1354. Native [PR 73](https://repos.openape.ai/patrick/monorepo/pulls/73); worktree `pods-conversation`, branch `feature/issue-1354-pod-identity-settings`, implementation checkpoint `c9c590daf3cec69237bb9571a158bd1112a0a227`, canonical base `25529c59fe4d815232b98128fa8b1955684a96de`.

General account setup now contains personal DDISA and Codex / GPT sign-ins. The Pod Settings tab displays its actual agent identity and deciding owner, with issuer details and account-wide provider consent management collapsed below it. Scoped identity reads expose public fields without provisioning or moving existing bindings. Revocation confirmation explicitly covers all Pods using that consent.

Full lint/typecheck, app build, all 267 Pods unit/component tests and five focused native onboarding cases pass. Inspected English/German and narrow dark screenshots: [verification report](https://testrun.openape.ai/r/1awLyd__KmNbN_1Z07CHexCJ). No full local E2E suite or live mail/model/Telegram test call. Next: retain reviewed source/target SHAs, await exact-source external checks, merge, sign/notarize and install with a paired app/profile backup. The linked PR delivery comment is authoritative for final SHAs, signing and preservation receipts; earlier entries below are historical checkpoints.

## Pods server rollout and signed local installation (September 19, 2026)

Issue: https://git.openape.ai/openape-ai/openape/issues/1354. Server [PR 70](https://repos.openape.ai/patrick/monorepo/pulls/70) merged as `ce1a8fb87536fb471bbb01dce16884cf098be9d9` after all exact-source external checks passed. Both `id.openape.ai` and the independent `pods.openape.ai` run image pin `prod-ce1a8fb8`. HTTPS health, Grant Brokering 1.0 discovery, independent signing keys and refusal of unauthenticated writes pass. Existing owner identities, passkeys, signing keys and all 47,603 predeployment grant IDs/payloads are preserved.

Internal signing [PR 71](https://repos.openape.ai/patrick/monorepo/pulls/71), source `ad93686159a301a9b715a15cdba5cc0d3b20368b`, produced an Apple-accepted, stapled app and DMG. The installed app passes Gatekeeper and the mounted-DMG deterministic check. Four Pods, 107 runs, 13 encrypted credential files and the existing enabled schedule were retained. External candidate/public-release gates remain separate; `releaseReady` is false. No real mail/model/Telegram test request or schedule change.

Worktrees: `pods-conversation` (internal signing) and `pods-rollout` (clean canonical server deployment, then delivery evidence). Exact local checks, submissions, hashes and paired rollback locations: [delivery receipt](../../.claude/reports/2026-09-19-signed-rollout.md). Consult the linked native PRs for their final merge/check receipts. Next user step: explicitly connect the agent provider in Pods for new identities; existing Pods retain their bindings. Earlier implementation checkpoints below are historical.

## Federated Pods grants (September 19, 2026)

Implementation [PR 69](https://repos.openape.ai/patrick/monorepo/pulls/69), code source `40aeb4ba314bda319b0dd4ced2b4e377d42ab00e`. Issue: https://git.openape.ai/openape-ai/openape/issues/1354. Worktree: `pods-conversation`; branch `feature/issue-1354-federated-grants`; base `fe4432e5`. Approved plan: [grant brokering](../../.claude/plans/2026-09-19-grant-brokering.md). Protocol [PR 1](https://repos.openape.ai/patrick/protocol/pulls/1) merged as `25b6d89b8fc6c21f171df6c78cf6a30ca9f1ff99` and mirrored. Implementation adds durable owner consent, typed broker assertions, immutable external agent bindings, owner-only grant lifecycle, original signatures and direct owner-IdP consumption. Pods separates the agent provider from the deciding account; existing identities remain unchanged.

Full lint/typecheck, affected application builds, 2,136 unit/component/conformance tests and one focused native layout case pass; eight existing apes tests remain skipped. Evidence and precise commands: [verification](../../.claude/reports/2026-09-19-grant-brokering/verification.md). No full local E2E suite completed, real mail/model/Telegram request, schedule activation or owner-profile change. The default push hook unexpectedly entered E2E checks; it was interrupted during the second package. The push-only hook skip respects the local E2E restriction; native CI gates remain mandatory. Public `pods.openape.ai` has no DNS/service yet; deployment prerequisites are documented in [operations](../operations/grant-brokering.md). Next: review the native PR against its exact source/target and await required external checks, then merge and perform paired app/profile local installation. Do not claim a live federation deployment.

## Pods central OpenApe account (September 19, 2026)

Issue: https://git.openape.ai/openape-ai/openape/issues/1354. Worktree: `pods-conversation`; branch `feature/issue-1354-central-account`; base `bca8ecc7`. Owner approved central account management and explicit default selection. Implemented persistent sidebar identity, explicit default for newly provisioned Pods, advanced issuer settings, reconnect retaining existing bindings and refusal to transfer disconnected Pods to a different owner. Schema 19 adds nullable `onboarding.default_owner`; existing profiles require one explicit selection, without changing existing Pods or schedules. Full lint (51 tasks), typecheck (72 tasks), app build, 259 unit/component tests and five focused native tests pass. Synthetic-only English/German screenshots, including narrow dark mode, inspected. Native PR review, exact-source external checks, merge and local installation remain. Delivery receipts: `/Users/patrickhofmann/Companies/private/repos/openape/openape-pods/.claude/reports/2026-09-19-central-account/`.


## Native issues: implementation and cutover handoff

The approved private MVP is implemented through M1–M6. API/CLI, UI, product reporting, explicit PR relations and external-code issue homes are merged through native PRs 60–65; canonical checkpoint `d9c7d092e05496a472ef26f38f42c5e5d6c79b28` retains their sources and the full-byte Pods assertion correction. App entry points are reviewed in [PR 66](https://repos.openape.ai/patrick/monorepo/pulls/66); migration/restore tooling is reviewed in [PR 67](https://repos.openape.ai/patrick/monorepo/pulls/67). Read those PRs and the synchronized [approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2A5ZAT63A04PWGVBT5M14MW) for their current exact source, target, checks and merge receipts.

Current migration checkout: `native-issues-migration`, branch `feature/issue-1356-native-issues-migration`. Application/operator source `4cedf59baeb63b8312e36b9b6f8f76ba4bfad068` passes all 17 clean local gates at `.openape/check-results/1789756255457-4cedf59b-all/summary.json`: 181 Git app tests, six operator contracts, seven real IdP/CLI workflows and five actual browser workflows. The following documentation-only closeout does not change those feature contracts; normal final-head gates remain required. [Synthetic desktop/mobile evidence](https://testrun.openape.ai/r/SL61judviok6wU7oSMV8qU5X) contains 18 inspected screens. App entry-point source `dd8e77928d7742ad523d27703de01bacb8e31e95` also passes all 17 clean local gates, all 19 app builds and actual Pods menu checks.

The isolated source rehearsal reconciles 230 issues, 175 comments, 15 labels, three actual attachment byte streams and 37 history rows. Repeated/delta/interrupted import, complete mapping/provenance hashes, actual encrypted Restic restore and the packaged operator inside the existing Linux image pass without changing Git refs. Private source files remain ignored and restricted. No historical account receives native permissions automatically. The 19 assignment and 81 external-reference dispositions are rehearsal-only, not approved production exceptions.

Next: complete any outstanding exact-source merge gates in PRs 66/67, then the separately approved M7 cutover in the [migration runbook](../operations/native-issues-migration.md). The plan contains the concrete pilot recommendations and read-only host preflight. Production import/activation, source fencing/rebinding, compatibility routing, app flags and individual source-owner acceptance retain that gate. No production issue migration, feature activation, source gateway change or installed owner Pods profile mutation was performed by these implementation increments. Public/anonymous rollout remains deferred.

## Native issue reporting entry points (M4)

`native-issues-entrypoints`, branch `feature/issue-1356-native-issues-entrypoints`, base `9c523ee6`. All 19 app workspaces now have a product reporting entry: the Git app, fourteen web app footers, the Pods native Help menu and agent/Nest/chat CLI help. Web links use `NUXT_PUBLIC_ISSUE_REPORTING_ENABLED=true`; Pods uses `OPENAPE_PODS_ISSUE_REPORTING_ENABLED=1`; daemon/CLI help uses `OPENAPE_ISSUE_REPORTING_ENABLED=1`. Every new entry is off by default. Only the approved product key goes to the fixed native reporting URL; web referrers are suppressed. Full lint/typecheck, all app builds, shared-component browser checks and the real Electron menu flow pass. Native production rollout and source migration remain separately gated.


## Native issues — M4 external issue homes (September 18, 2026)

`openape-monorepo.worktrees/native-issues-apps`, branch `feature/issue-1356-native-issues-apps`, base `674de015` (M4 core). Adds fresh issue-only repository registration with an explicit external HTTPS code URL, private metadata and matching navigation. Real IdP/API/CLI/browser tests prove issues work without creating bare Git storage; Git transport, native PR and mirror writes are refused while normal Git reads still succeed. This is a separate M4 increment from the in-progress app-shell reporting links. Production registration and activation remain gated.




## Native issues — M5 explicit PR relations (September 18, 2026)

`openape-monorepo.worktrees/native-issues-links`, branch `feature/issue-1356-native-issues-links`, base `674de015` (M4 core). Adds reciprocal `Related` links with live access intersection and audited idempotent creation/removal. The actual IdP/CLI fixture successfully merges a real PR through the unchanged exact-SHA endpoint and confirms the linked issue remains open. Signed HTTP denial tests and Vue interaction checks pass. M4 core passed all 17 clean local gates and is pushed at `674de015`; app-shell links and external-code issue homes are still outstanding M4 work. M2 external CI had one unchanged Pods database test timeout; the entire targeted suite passes locally and one exact-source retry is running. Continue through M4/M5 reviews and M6 rehearsal; production cutover remains separately gated.


## Native issues — M4 product reporting (September 18, 2026)

The dependent checkout `openape-monorepo.worktrees/native-issues-reporting`, branch `feature/issue-1356-native-issues-reporting`, starts from M3 source `597de762`. It adds versioned product routing, private report participation, intake-only transfer with explicit label mapping, audited moderation and matching web/CLI flows. The real IdP/CLI suite covers report → transfer → discussion → revocation. Browser checks exercise product preselection through login and responsive reporting. M1 is merged through PR 60 at `048ab8ab`; M2 is in PR 61. Product registration and production intake creation remain disabled until rollout. App-shell links and external-code issue homes follow in a separate M4 increment; continue M5/M6 before requesting the concrete production cutover approval.


## Native issues — M3 UI (September 18, 2026)

The approved UI is implemented in `openape-monorepo.worktrees/native-issues-ui`, branch `feature/issue-1356-native-issues-ui`, based on M2 `039e3ad6`. Repository/overview pages, safe previews, discussions, metadata and stable participant links use the private API. Real IdP-backed CLI/session tests and actual-CSS desktop/mobile browser checks are registered in the shared contract; synthetic screenshots and a portable report are generated under the Git app `.artifacts/issues/`. Continue final gates, native diff review and exact-source merge, then product reporting, explicit PR relations and migration rehearsal. Keep production issue data untouched until the separate M7 approval.

## Native issues — M2 API and CLI (September 18, 2026)

Two exact-source external CI attempts hit the 5-second limit in the unchanged Pods future-database byte assertion. Replace recursive Buffer equality with native `Buffer.equals`, preserving complete byte comparison without per-byte JavaScript traversal; do not increase the timeout or bypass CI.

The dependent checkout `openape-monorepo.worktrees/native-issues-api`, branch `feature/issue-1356-native-issues-api`, starts from reviewed M1 source `c5e12cea`. It adds private issue/comment/label routes, safe Markdown rendering, same-origin cookie mutations, bounded inputs/rates and matching native CLI commands. HTTP tests exercise real H3 handlers, file-backed SQLite and signed SP tokens. Root CLI tests preserve literal body-file contents, retry headers and pre-request validation. Full Nuxt/IdP/CLI and UI verification follow in M3 before enabling the capability. Continue through the approved milestones without a per-milestone session handoff; production migration remains gated.

## Native issues — M1 implementation (September 18, 2026)

Patrick requested end-to-end execution of [the approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2A5ZAT63A04PWGVBT5M14MW), tracked by [issue 1356](https://git.openape.ai/openape-ai/openape/issues/1356). The isolated checkout is `openape-monorepo.worktrees/native-issues`, branch `feature/issue-1356-native-issues`, based on canonical `0f7425539c81950e54882bd851190f58e9011302`. M0 was already merged through PR 50. M1 adds ordered transactional database migrations, private issue storage, live grant-aware visibility and verified exact-scope principals. Ten focused storage tests, all 153 Git app tests and all 105 auth module tests pass; lint, typecheck, Git build and Doctor pass. Initial source `c5e12cea` passed all 15 local gates and all three external checks; the layout retry passed after an unrelated Pods pointer-drag timing failure. Canonical `6c53b6ec` is integrated, preserving the concurrent Pods work; repeat exact-source verification before merging PR 60. Continue through M2–M6 after independently reviewed increments; keep the capability disabled until rollout. Production migration/cutover retains its separate M7 approval.

## Pods guided chat setup and model selection (September 18, 2026)

Owner-approved [plan](../../.claude/plans/2026-09-18-pods-guided-setup.md), [issue 1354](https://git.openape.ai/openape-ai/openape/issues/1354), worktree `pods-conversation`, branch `bugfix/issue-1354-chat-setup`, canonical base `0f7425539c81950e54882bd851190f58e9011302`. Concrete HTTP, directory and application reviews now live in chat; ordinary missing values have answer forms, secret proposals explain acquisition and open the protected alias field. Saved script status and continuation replace the misleading automatic sample. GPT-6 Astra and the bundled GPT-5.6 models are selectable and passed through on creation/resume. The two-minute total deadline is replaced by inactivity and total bounds.

Full lint/typecheck/build, 41 focused unit/component checks and 16 synthetic native cases pass. Inspected screenshots cover prefilled HTTP scope, German narrow dark resolved cards and Astra selection. Tests verify native cancellation, persisted real permissions, exact outbound model IDs, secret isolation and zero fixture runs/enabled schedules. Retain permanent tests for these owner-control and routing contracts. No owner profile mutations or real mail/model/Telegram calls. Next: normal commit/push gate, native PR review and exact-source merge checks, then clean packaging and paired app/profile installation. Preserve the owner-enabled schedule. Final SHA/PR, full gates and installation receipts belong to the local `2026-09-18-chat-setup` report.

## Pods publication completed (September 18, 2026)

Patrick requests committing and pushing the current Pods source to the canonical repository and completing the normal PR workflow. Existing [PR 56](https://repos.openape.ai/patrick/monorepo/pulls/56) will contain the accumulated desktop changes: simpler permissions, directory access, immutable dependencies with npm search, explicit agent tools, bounded application HTTPS, owner selection, execution approvals and readable recovery. Canonical main `59e0de19309cc80cb2e1996057f0f981699ff32d` is integrated without product changes; the only merge conflict was this status index. The IdP code is already identical to main.

Installed source remains `598c0fb3620804081dd189fbf56c581035867335`; no reinstall is needed for this documentation merge. Patrick confirmed successful mail delivery and independently enabled the 15-minute Mail-Kurzbericht schedule. Read-only inspection confirmed an active Pod, enabled interval, successful delivery/no-new-mail runs, no queued recovery and no storage error; the two other Pods remain paused. Do not change the live profile or schedule while publishing code.

PR 56 is merged at `325588d4b795e93a7b8a72d9d6dfaf34bc543d2c`. Reviewed source `bd758f422dc766e812a4abe8f6148a8302fa6227` and target `59e0de19309cc80cb2e1996057f0f981699ff32d` matched the merge request. Full clean local gate `.openape/check-results/1789738786595-bd758f42-all/summary.json` passed, including 236 Pods unit/component and 127 native cases; exact-source CI, E2E and layout all passed externally. Existing native fixtures were updated for the current UI and real signed managed-runtime grant boundary; an asynchronous tab assertion now waits for the rendered Settings panel. All providers in tests are synthetic. Merge, reviewed diff and exact check receipts are in the local `2026-09-18-publication` report. Earlier dated entries below describe prior delivery snapshots and constraints.

## Pods conversational chat layout (September 18, 2026)

Owner-authorized continuation of [issue 1354](https://git.openape.ai/openape-ai/openape/issues/1354), worktree `pods-conversation`, branch `feature/issue-1354-chat-layout`, canonical base `325588d4`. Chat now uses right-aligned user messages, plain assistant replies, a bottom composer with Enter/Shift+Enter and stop controls, and collapsed technical activity/drafts. The original request appears once in the conversation. Access proposals remain reviewable; permissions and runtime execution are unchanged. Full lint/typecheck/build and 12 focused component cases pass. Four packaged cases cover creation, pending/declined access, original-message retention, restart/localization, narrow dark layout, fixed composer geometry and scroll-follow behavior without interrupting reading. Native empty-chat assertions now verify the visible welcome and composer. Bilingual screenshots were inspected and both illustrated handbooks regenerated. Keep the owner's enabled schedule and user data during local delivery. Complete native PR review, exact-source gates, merge, clean packaging and paired app/profile installation; record the final source and evidence in the local `2026-09-18-chat-layout` report.

## Pods run simplification (September 18, 2026)

Local continuation of [issue 1354](https://git.openape.ai/openape-ai/openape/issues/1354) on `pods-conversation`, branch `feature/issue-1354-simple-permissions`, starting at `4464a669514ede130a66b44fe0e9eaec55e86491`. Existing PR 56 predates this local work; Patrick now requests publication of the current desktop source through that PR. The later explicit publication authorization supersedes the previous no-full-E2E constraint. History groups observed operations, shows successful and unfinished counts, and guides stopped runs through inspection before retry. Overview opens recovery instead of queueing another run. Storage inventory counts Codex temporary symlinks without following targets; backup validation remains strict. Handbook JSON now preserves the previously Markdown-only execution-approval guidance.

Full lint (51 tasks), typecheck (72 tasks), app build and 23 focused unit/component checks pass. Permanent regression coverage protects storage inventory/backup boundaries and retry navigation. The single synthetic readable-run native fixture passes; inspected DE/EN and narrow screenshots show grouped success/failure and the next action; no full E2E or live mail/model/Telegram calls are authorized. Exact screenshot, clean package revision, installation and owner-data verification receipts belong to `/Users/patrickhofmann/Companies/private/repos/openape/openape-pods/.claude/reports/2026-09-18-run-simplification/`. Local delivery uses the normal unit commit hook and a paired app/profile rollback; the receipt records the installed clean SHA and final owner-state comparison. At installation, all owner content was preserved and schedules remained disabled; only recalculated storage usage and clearing the diagnosed inventory warning are expected database differences.

## Readable Pods execution and approvals (September 18, 2026)

The approved [implementation plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2SQ8F3QCKHNYHES1BKEET2C) is implemented locally in `pods-conversation`, branch `feature/issue-1354-simple-permissions` (issue [1354](https://git.openape.ai/openape-ai/openape/issues/1354), existing PR 56 remains unpushed). Consumed once grants are renewed, managed execution uses a Pod-scoped shape through the ape-shell authorization library, waiting approvals open automatically with an in-app fallback, and History exposes actual activity and safe recovery guidance. Secrets remain assigned per Pod across validated script changes. The native sandbox remains; external terminals still use ape-shell CLI.

Focused signed-grant, native sandbox, approval timing, recovery and component checks pass. A synthetic local IdP instance renders the actual grant page and verifies a standing rule accepts the next script request. No full E2E, live mail/model/Telegram runs, schedule activation or remote push. The isolated IdP grant page is now merged and deployed through PR 57 / `59e0de19`; see its publication row below. Exact package/installation/profile-preservation receipts are maintained in the planning workspace `.claude/reports/2026-09-18-readable-runs/`. Read those receipts before further delivery. Existing owner records, both real runs and encrypted files must survive installation.

## Pods owner correction (September 18, 2026)

Patrick confirmed his OpenApe owner is `patrick@hofmann.eco`, independently of the `phofmann@delta-mind.at` mailbox. `apes whoami` confirms this. The prior Mail-Kurzbericht setup incorrectly reused the app’s older OpenApe connection, causing both approval POSTs to return 403. A normal browser sign-in connected the correct account without copying shared CLI refresh credentials. Connection selection now preserves an existing Pod owner, uses the newest ready account for new Pods and fails closed on duplicate owner bindings. Two focused regression checks plus translation checks pass. Installed clean `b70736a68ac577d7f474f9f8c08001b5b2ec4b33`; Mail-Kurzbericht alone was rebound, two replacement grants are pending and both superseded grants are revoked. Owner-only server verification returns 200; draft 6 validates synthetically. Other Pods retain their owners and data; o365 state and Telegram ciphertext are unchanged. All three Pods remain paused with zero runs/enabled schedules. No full E2E or push. Receipt/current approval links: /Users/patrickhofmann/Companies/private/repos/openape/openape-pods/.claude/reports/2026-09-18-owner-correction/README.md.

## Pods mail preparation and application networking (September 18, 2026)

Installed clean `e0fe3eb50a9cffd2076b296e75cf547356332478` from `pods-conversation`, issue 1354 / existing PR 56 continuation. Assigned applications expose bounded HTTPS hosts; proxy DNS is pinned to public IPv4. Only network-enabled application processes get macOS trustd access, verified by isolated o365 silent refresh. Full lint/typecheck/build, 29 focused checks and 220 Pods unit checks via the normal hook pass. Mail-Kurzbericht draft 5 is synthetically validated, Telegram identity/destination verified, and the secret encrypted. The two scoped mail/Telegram grants are pending owner approval. All three Pods remain paused with zero runs/schedules. Other-Pod rows are unchanged; the OpenApe owner credential was resaved during enrollment and two encrypted records were added. The script launcher requires a separate ape-shell grant; no broad permanent shell grant is authorized. Code-bound secret approval, a controlled first baseline and new-mail delivery test remain open before enabling the interval. No full E2E/push. [Inspected installed evidence](https://testrun.openape.ai/r/yHh0ISy9oFCSoLAjoEVyHAzZ). Setup/rollback receipt: /Users/patrickhofmann/Companies/private/repos/openape/openape-pods/.claude/reports/2026-09-18-mail-setup/README.md.

## Pods agent tool selection (September 18, 2026)

`pods-conversation`, issue 1354 / existing PR 56 continuation: `context.agent.run` defaults to no tools and accepts explicit `tools: []` or `tools: ["ape_shell"]`. Runtime validation and the creation-chat reference share this contract. Tool-free calls have no MCP configuration/broker and the provider gateway forces an empty tool list. Both handbooks are updated. Full lint/typecheck, app build, seven focused unit checks and three native SDK transport cases pass; the native cases cover default/explicit no-tools with forced calls plus explicit assigned-tool operation. These security-boundary regression tests are retained. Installed from clean bb156ca1c176efce183be226b277dca72665004f. The normal commit hook also passed 217 Pods unit checks; two focused installed-runtime probes passed with synthetic provider responses. Mail-Kurzbericht draft 4 now uses explicit tools: []; all eight encrypted files and all three paused Pods are preserved, with zero runs/enabled schedules. No full E2E, push or merge was performed. Existing network/grant/Telegram readiness gates remain separate. Evidence: /Users/patrickhofmann/Companies/private/repos/openape/openape-pods/.claude/reports/2026-09-18-agent-tools/README.md.


Updated 2026-09-18. This is a handoff index, not an assumption that an old branch
still matches live main. Re-read the plan and Git refs at session start.

| Work | Issue / plan | Checkout | Verified evidence | Next step |
|---|---|---|---|---|
| Readable Pod grant publication | [Issue #1354](https://git.openape.ai/openape-ai/openape/issues/1354), [approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2SQ8F3QCKHNYHES1BKEET2C) | `pods-grant-publication`, `feature/issue-1354-readable-pod-grants`, base `5c48396b` | Four IdP files extracted unchanged from locally installed Pods source `4464a669`; [isolated real IdP and installed UI evidence](https://testrun.openape.ai/r/5Nwcc1z7rKqiRgpSfyyX9tRV). Owner authorized publication on September 18. | Merged via PR 57 at `59e0de19309cc80cb2e1996057f0f981699ff32d`; IdP tested-image deployment and served bundle verified. Desktop publication is tracked above. |
| Pods dependency list and npm search | [Issue #1354](https://git.openape.ai/openape-ai/openape/issues/1354), owner continuation September 17 | `pods-conversation`, `feature/issue-1354-simple-permissions`, base `c897478b` | List with fixed versions, plus/minus, public npm search and npm package URLs; metadata-only bounded main-process requests, explicit preparation unchanged. 16 focused checks, real registry search/link probe, full lint/typecheck and one packaged UI case pass; DE/EN screenshots inspected. | Installed clean `507fe6977`; schema 18, 54 owner tables and seven ciphertexts preserved, two paused Pods, zero runs/schedules. [Evidence](https://testrun.openape.ai/r/bk53PHLgDyE7gpxikOKrZ_x_). Paired rollback 2026-09-17-150655. No push/full E2E. |
| Pods managed script dependencies | [Issue #1354](https://git.openape.ai/openape-ai/openape/issues/1354), [authorized plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2QMBY4KX5MW1X4S225NPE56) | `pods-conversation`, `feature/issue-1354-simple-permissions`, base `3587a2ef` | Exact package declarations, isolated public-registry npm preparation, read-only hashed sets, schema 18, script/credential binding, backups and bilingual editor/chat/handbooks. Targeted unit checks and packaged synthetic execution passed; packaged npm prepared csv-parse 6.1.0. HTTP section gap increased to 36px. | Installed clean `2636e82b`, schema 18; 50 existing tables, stable settings and seven encrypted files preserved, two paused Pods and zero runs/schedules. [Evidence](https://testrun.openape.ai/r/r2nUtVFucRgYWTDBhQXRXu7K). Paired schema-17 rollback retained. Do not push/full-E2E: owner tests manually. No owner mail, secrets, messages or schedules used. |
| Pods simple permissions and directories | [Issue #1354](https://git.openape.ai/openape-ai/openape/issues/1354), owner UI correction September 17 | `pods-conversation`, `feature/issue-1354-simple-permissions`, previous local install `d5033491` | HOME/workspace rows plus native folder assignment with read/read-write selectors and revocation. Schema 17 preserves resource rows; script and broker sandboxes consume explicit directory permissions. Targeted UI/storage/backup tests, native RO/RW/symlink probe and one packaged UI/script case pass; inspected DE/EN screenshots including narrow dark layout. | Installed clean `15d9115c`; schema 17 startup preserves owner content and encrypted state. [Evidence](https://testrun.openape.ai/r/eZImUaZDvgO3iFTwHVSIUhJb). Paired schema-16 rollback retained. PR 56 source `95b34767` predates these local changes. Owner explicitly takes over full E2E: do not trigger full CI by pushing. External owner terminal/GUI remains Mac-user/ape-shell scoped, not directory-sandboxed. |
| Pods installed applications | [Issue #1354](https://git.openape.ai/openape-ai/openape/issues/1354), [authorized continuation](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2Q8V14XWHSF894NFQF9CFA1) | `pods-conversation`, `feature/issue-1354-installed-applications`, base `82f16e0e` | Production o365 build removed; installed application picker and no-argument Play under the existing owner ape-shell boundary. List follows the owner's macOS screenshot. 15 focused unit checks and 7 packaged/native checks pass, including signed grant allow/deny, no-argument AppKit startup, private setup persistence and absence of bundled o365. DE/EN list screenshots inspected. | Verify, review, package and install with paired rollback. Preserve owner pods and credentials. No live mail/messages/schedules. GUI HOME is not proof of application account isolation. |
| Pods external ape-shell | [Issue #1354](https://git.openape.ai/openape-ai/openape/issues/1354), [authorized plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2M9YDS92G8GA3T84KQDPBKY) | `pods-conversation`, branch `bugfix/issue-1354-terminal-start-feedback`, base `5179cda7` | PR 53 installed with paired rollback and preserved owner data. Owner terminal click exposed missing production Pod enrollment route (404); tested IdP `5179cda7` deployed with health gate and previous tag `3f07d0db`. Unauthenticated enrollment now correctly returns 401. | Review/ship direct launch progress and inline failure feedback; owner native Terminal.app confirmation remains manual because computer-use tooling excludes it. Bundled o365-cli is historical prototype scope; future tool assignments should use owner-installed executables with preserved program state. No owner task, mail, model, Telegram or schedule activation. |
| Native issues M0 | [Issue #1356](https://git.openape.ai/openape-ai/openape/issues/1356), [approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2A5ZAT63A04PWGVBT5M14MW) | `openape-monorepo.worktrees/native-issues-m0`, branch `feature/issue-1356-native-issues-m0`, base `08b1eaae3f9a129ee4b3c7563ba3803030bed43e` | [Inventory and disposable rehearsal](../operations/native-issues-migration.md): 230 issues, 175 comments, 993 timeline records; issue writes blocked while branch/main pushes and actual Actions succeed. Eight inventory tests, full lint/typecheck and Doctor pass. All 15 local CI steps pass at `.openape/check-results/1789473266340-08b1eaae-all/summary.json`, including 110 Pods native tests. Use `DEVELOPER_DIR=/Library/Developer/CommandLineTools`; default Xcode selection fails on its unaccepted license. | Review the native PR and exact-source checks. M1 starts with repository authorization/storage. Actor mapping, attachment integrity, independent owners, full freeze coverage and legacy-login fragment continuation remain migration gates. No native issue feature or production import in this increment. |
| Pods creation chat and description | [Issue #1354](https://git.openape.ai/openape-ai/openape/issues/1354), [PR 46](https://repos.openape.ai/patrick/monorepo/pulls/46), [PR 47](https://repos.openape.ai/patrick/monorepo/pulls/47) | Delivered from clean merged `e18fcc17` | Exact start request and 32 owner chat entries recovered; real 536-character description and full installed restart verified. 178 unit/component and 108 native tests passed. | [Installed evidence](https://testrun.openape.ai/r/5kVqVmILpHA-rUKzSTj2FYFt). Subsequent approved script-authority change below supersedes the separate execution assignment. |
| Pods script authority | [PR 48](https://repos.openape.ai/patrick/monorepo/pulls/48) | Installed clean `08b1eaae` | Schema 16, name-only metadata, preserved execution bindings and owner migration/restart pass. | [Installed evidence](https://testrun.openape.ai/r/0W4ODmIkT0Qbdym36HZOzwHU). Mail-Alarm remains paused with setup pending. |
| Pods variables and secrets | [PR 49](https://repos.openape.ai/patrick/monorepo/pulls/49) | Installed clean `2217269d` | Seven-tab UI, explicit empty values and required secrets; full gate, external checks, DMG and unchanged owner restart verified. Telegram destination later saved through the owner UI. | [Installed evidence](https://testrun.openape.ai/r/VS80JHNHl6-ZLyttVgSjCRqf). Application setup remains pending. |
| Pods command terminal | [Issue #1354](https://git.openape.ai/openape-ai/openape/issues/1354), [plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2JRW66M2CQEC9SE2448BA8E) | `pods-conversation`, `feature/issue-1354-pod-command-terminal`, base `1ba85c7e` | Replaces argument form with full-command prompt, assigned-app resolution and actual pod workspace cwd; private application HOME/cache persists. Focused component and packaged native tests pass, including denied outside read and setup-to-script reuse. | Delivered through PR 52 at `fc50c7e2`; superseded by the external ape-shell continuation above. Foreground script broker retains fork denial; no live provider calls. |
| Pods application actions | [PR 51](https://repos.openape.ai/patrick/monorepo/pulls/51) | Delivered from clean merged `1ba85c7e` | Application name dispatch, access controls and owner draft migration verified. | The command terminal continuation above replaces its arguments panel. |
| Pods prompt-driven setup | [Issue #1354](https://git.openape.ai/openape-ai/openape/issues/1354), [approved implementation plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2HN7WGNBBDWVEC0ETEQN9J4) | `openape-monorepo.worktrees/pods-usability`, branch `feature/issue-1354-prompt-setup`, base `f41487a3` (merged PR 44) | Generic application/terminal/HTTP work is merged and packaged. This follow-up adds chat configuration, runtime guidance, selected-pod action scope and Settings links for secret proposals. 166 unit/component tests and 11 targeted native/packaged tests passed during development, including one visible prompt, validation repair and a manual file/checkpoint run with a recorded model. | Complete full gates, review/merge and prepare the new package. PR 45 also verifies that chat inspection reads the same saved working source as the editor, including manual edits. Patrick explicitly deferred owner installation on September 15. No owner profile, provider credentials, live mail, Telegram delivery or owner schedules are touched. Live model quality remains separate acceptance. |
| Pods simplified workspace | [Issue #1355](https://git.openape.ai/openape-ai/openape/issues/1355), [PR 43](https://repos.openape.ai/patrick/monorepo/pulls/43), [approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2G2D2ZVE00RPKRVBF7PTB7E) | Merged at `70b7a410`; the preserved `pods-usability` worktree now hosts the issue-1354 continuation above | Six tabs, per-pod chat, highlighted editor, Settings values, resizable sidebar and schema-13 migration. 140 unit/component and 93 native/Electron tests pass, including real macOS safeStorage. Full local and exact-source external gates passed. Both illustrated manuals, clean merged distribution and paired app/profile delivery are verified. | Owner feedback identifies remaining legacy mail-specific permissions and onboarding; track correction under issue 1354. Installed owner app/profile remain unchanged during the new synthetic tests. |
| Pods programs and icon | [Issue #1354](https://git.openape.ai/openape-ai/openape/issues/1354), [approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2FVCAY9N2S7KFEHXHBV6QMB) | `openape-monorepo.worktrees/pods-programs`, branch `feature/issue-1354-pods-programs-terminal`, base `37c2a454` | Custom macOS icon packaged and byte-verified. [G0 probes](../../apps/openape-pods/experiments/programs/README.md) prove PTY basics and a detached-child lifetime failure when fork is enabled; production policy is unchanged. | General shell/GUI execution remains blocked by G0. Review a revised lifetime mechanism or explicitly narrower foreground-CLI scope. Deliver the icon independently after exact-source gates. Preserve the paused owner pod and all account connections. |
| Pods direct script credentials | [Issue #1353](https://git.openape.ai/openape-ai/openape/issues/1353), [PR 41](https://repos.openape.ai/patrick/monorepo/pulls/41) | `openape-monorepo.worktrees/pods-implementation`, source `0cda0d69` | Real macOS safeStorage acceptance passes with real HOME and asserted isolated userData/sessionData. Full clean 15-step gate, 128 unit/component and 91 native/Electron cases pass at `.openape/check-results/1789386985801-0cda0d69-all/summary.json`. | Merged through PR 41 at `e56c3972` after all exact-source CI/E2E/layout gates; include schema-12 migration backup in the refreshed icon delivery. Earlier keychain failure reports are historical; no synthetic cipher substitutes for this successful default test. |
| Pods German/English | [Issue #1352](https://git.openape.ai/openape-ai/openape/issues/1352), [plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2DTN55XMA45JTFADRDRVN9Q) | `openape-monorepo.worktrees/pods-implementation`, branch `feature/issue-1352-pods-localization`, base `959aa468` | Persisted language switcher, renderer/native localization and two illustrated handbooks. Packaged switching, retained source, restart and native menu/dialog checks pass. Full evidence is maintained in the plan. | Complete exact-source native PR review and required CI/E2E/layout gates; no live account/provider access, owner schedules or signed release. |
| Pods sidebar groups | [Issue #1351](https://git.openape.ai/openape-ai/openape/issues/1351), [plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2DR8FJBBJ3PKFW25FH0EX71) | `openape-monorepo.worktrees/pods-implementation`, branch `feature/issue-1351-pods-groups` | Persistent flat groups, collapse, move and remove while retaining pods; schema 11 separates organization from assignment revisions. 111 unit/component cases pass, including migration, grouped backup/restore and stale open-form conflicts. | Packaged UI flow and all 84 native cases pass; handbook has 16 chapters and 10 inspected images. Full 15-step gate is recorded in the feature plan. Native PR review and exact-source external checks precede integration. Existing live-service and signed-release gates remain open. |
| Pods implementation / release acceptance | [Issue #1349](https://git.openape.ai/openape-ai/openape/issues/1349), [approved continuous implementation plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2A2ZV0AAPDW75YMD4TVG8Q5) | `openape-monorepo.worktrees/pods-implementation`, branch `feature/issue-1349-pods-implementation` | M1–M11 merged through PR 36 (`b5a4ccac`). M12 code source `ce6edb7709563cd2812c2a3ce16c53a95fd6878a` is reviewed in [PR 37](https://repos.openape.ai/patrick/monorepo/pulls/37), with 97 unit/component and 82 native/Electron passing tests; full clean 15-step gate `.openape/check-results/1789310426429-ce6edb77-all/summary.json` passed. [M12 evidence](https://testrun.openape.ai/r/Ro7zOvnpRye6WfuW1t8a-c_s) includes four inspected screenshots and actual read-only DMG execution. | PR 37 is the final implementation increment; consult its live merge/check state. After integration, only the separately authorized release acceptance remains: real authentication/provider/tenant refresh, physical sleep/wake, authoritative native license notices, signing/notarization/Gatekeeper and clean-machine OS/CPU acceptance remain release gates. Current execution pilot: Darwin 25.6.0 arm64 only. No live mail, real identities/provider credentials, owner schedules or release publication. |
| Pods M1 desktop foundation (merged PR 25) | [Issue #1348](https://git.openape.ai/openape-ai/openape/issues/1348), [approved M0 / M1 plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2A2ZV0AAPDW75YMD4TVG8Q5) | `openape-monorepo.worktrees/pods-foundation`, branch `feature/issue-1348-pods-foundation`, canonical base `db8d87cd`, audit prerequisite `21d80190` | [App scope and verification](../../apps/openape-pods/README.md); 7 unit/component tests and 4 actual Electron tests pass; complete 15-step unit/E2E/layout contract passed locally in `.openape/check-results/1789280749417-21d80190-all/summary.json` before commit. | Merged after all exact-source checks passed; canonical merge `82cc47a5`. Continue in issue 1349. |
| Production dependency audit | [Issue #1347](https://git.openape.ai/openape-ai/openape/issues/1347) | `openape-monorepo.worktrees/audit-dependencies`, branch `bugfix/issue-1347-audit-dependencies`, base `db8d87cdbf67f6ac497a84004edebddc2f624240` | [Repair and evidence](../operations/dependency-audit-1347.md): audit high/critical reduced to zero; full forced lint/typecheck, 48-task build and complete CI passed (`1789196274249-db8d87cd-all`). | Merged via native PR 23, canonical merge `95bae482`. No deployment or publication. |
| Unified Node and cli-auth release | [Issue #1344](https://git.openape.ai/openape-ai/openape/issues/1344) | `openape-monorepo.worktrees/ai-workflow`, branch `fix/issue-1344-node-toolchain`, base `eeeaa763` | Node 24.15.0 pinned in `.nvmrc`, local activation and CI share the pin; cli-auth 0.5.5 is a scoped Changesets patch. | Read the issue for exact PR/check/merge/publication evidence. Publish only cli-auth via the explicit release filter from clean canonical main; npm authentication must succeed. |
| Restricted-session toolchain | [Issue #1343](https://git.openape.ai/openape-ai/openape/issues/1343) | `openape-monorepo.worktrees/ai-workflow`, branch `fix/issue-1343-session-toolchain`, base `4914bb03` | pnpm launcher/cache failure reproduced with network and cache writes denied; direct pinned pnpm runs the project Doctor and dry-run. [Setup and evidence](../operations/session-toolchain.md). | Read the issue for PR and exact check/merge evidence; follow the toolchain setup in new restricted sessions. |
| AI workflow rollout | [Issue #1342](https://git.openape.ai/openape-ai/openape/issues/1342), [live approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M1X6QVHZ5HXR11C7T0SVW206) | `openape-monorepo.worktrees/ai-workflow`; final acceptance is a separate fresh clone `/tmp/openape-workflow-fresh`, branch `fix/issue-1342-local-startup` | Checkpoint `a4921e2f` (PR #19); M0–M6 complete. Sources/check runs in [rollout evidence](../operations/ai-workflow.md). New Tasks/ape-pr dev ports started successfully with isolated data. | Read the live plan for final PR, exact checks/merge and independent session outcome. If it is done, no rollout work remains; select a new task explicitly. |
| Existing CRM work | existing `feature/crm-variante-b` branch | original `openape-monorepo` checkout | Initial inspected HEAD `ea2ebc16`; unrelated untracked work preserved. | Resume only for an explicitly selected CRM task. |
| LLM pull queue specification | existing `spec/llm-pull-queue` branch | `openape-llm-pull-queue` linked checkout | Initial inspected HEAD `f740d0f0`; same Git repository, not another product repo. | Read its own diff and issue before continuing. |

Other registered worktrees are intentionally not labelled abandoned. Use
`git worktree list --porcelain` and inspect their status before deciding whether
to resume or remove them. Do not delete a worktree on the strength of this index.

At handoff, record the actual branch and SHA, PR URL, exact successful/failed
checks and their log paths, remaining blockers and the next concrete action.

## Native issue production pilot — September 20, 2026

Patrick approved the concrete M7 pilot in the existing plan. Work starts at
canonical main `934dbcec21cce8e3620ecda51a77aa8458bcfd30` in
`native-issues-cutover`, branch `feature/issue-1356-native-issues-cutover`.
The preflight source now contains 233 issues, 175 comments and three assets;
three new Pods issues explain the change since rehearsal. Nineteen assignments
remain unverified. Source restrictions/dependencies/projects/reactions/time
entries remain absent in the scoped database census. An off-site native-registry
backup completed before preparation. Production issue writes remain on Forgejo
until the frozen manifest passes reconciliation and the native lock is released.

This increment prepares reviewed source SQL and gateway service configuration.
The same SQL generator now passes the disposable real Forgejo Git/Actions proof
and an explicit removal/rollback check. Production operations, exact source/target
hashes, native activation and seven-day observation will be recorded in the
synchronized plan and restricted operator receipts. No issue authority changes
are implied by merging this preparation increment.

## Generic Reports — issue 1401

- Approved plan: https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3KTXVW1069NJZYPCNXNSTEA
- Issue: https://repos.openape.ai/patrick/monorepo/issues/1401
- Worktree: `openape-monorepo.worktrees/generic-reports`; branch `feature/issue-1401-generic-reports`.
- Base: `6b02cfc36508e1fe79dd4c4ffcbe81dc78edc85d`. Frozen install and doctor pass.
- Implemented generic private documents/categories, parser sanitization, HTTP/iframe sandbox, compatible adapters and the receipt-first PR client. Full lint/typecheck and app builds pass; Reports 57 unit + 16 E2E + nine layout tests, Pods 629 tests and CLI four tests pass. Migration twice preserves all legacy rows; the deployed rollback image safely rejects new private documents. See `docs/operations/generic-reports-migration.md`.
- Next: native PR/exact-source CI, clean-main deployment, real no-send producer previews, evidence upload, guidance and activation. Production, schedules and guidance are unchanged until acceptance.

## Pods redesign: Automatisierungen and Entscheidungen — issue 1430

- Plan: https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M48KYW8JJKRSRDWRJ9DQT13Q (repo copy `.claude/plans/2026-10-06-pods-redesign.md`; mock, capture script and reference manifest under `.claude/plans/pods-redesign/`). Issue: https://repos.openape.ai/patrick/monorepo/issues/1430. Owner approved the autonomous run M0 to M8 on October 6, 2026; M9 (signed release, relay deploy, acceptance) stays an owner gate.
- Worktrees `openape-monorepo.worktrees/pods-redesign-m<k>`, branches `feature/issue-1430-pods-redesign-m<k>`, one PR per milestone.
- M0 merged as `82d39a3a` (PR 267): `view=map` read model in `src/worker/workspace/map-view.ts`, published as `workspace.map`, relay `read view=map`, MCP read; synthetic 38-Pod fixture `test/worker/map-fixture.ts` and its JSON export `test/renderer/map-view.json`. The published variant keeps network members' rights, runs and system edges local.
- M1 merged (PR 269): `AutomationsShell`, `KpiRow`, `AutomationsMap` (canvas), `AutomationsList`, `AutomationInfo` under `src/renderer/central/`, utilities `automation-layout.ts`, `kpis.ts`, `cadence.ts`; mounted as the default page of the desktop and browser workspaces. Evidence through `apps/openape-pods/scripts/redesign-evidence.mjs` (screens carry the reference run's ids).
- M2 to M5 merged (PRs 270 to 273): `AutomationDetail` drawer and native `programs openFolder`; `DecisionsInbox` with five sections; `CodexHandoff` replacing every creation form; `AppSettingsMenu` as the gear menu.
- M6 merged (PR 274): secrets through the detail page. `SecretForm` (type, private file, OpenApe Secrets request); `src/contracts/secrets.ts`, IPC channel `secrets` (desktop only), worker table `secret_requests` (schema 39, additive); `src/main/secrets/gate.ts` registers this Mac as consumer at https://secrets.openape.ai with a P-256 key in the encrypted store, raises requests as the owner, polls every 60 s, collects the envelope once and stores the value through the existing `saveCredential` path; `src/main/secrets/box.ts` ports the service's seal/open algorithm. MCP administration `requestSecret {podId, alias, purpose, epoch}`. Tested against a synthetic service in `test/secrets/gate.test.ts`.
- M7 (PR 276): one shell. `WorkspaceFrame` without sidebar; `central/LocalShell.vue` hosts the shell for the registered desktop (`DesktopWorkspace`) and the local `App.vue`; `BrowserWorkspace` renders the same shell from the published map. The Pod editor, portable packages and the advanced desktop settings open from the shell and return with one button. Deleted: `GraphPanel`, `GraphOverview`, `GraphView`, `GraphInspector`, `WorkflowPanel`, `NetworkDetail`, `NetworkCreate`, `NetworkReplacement`, `NetworkConversion`, `NetworkRetirement`, `GateReview`, `ItemTrace`, `PodInventory`, `PodNavigation`, `MailWorkflowReview`, `MailWorkflowSettings`, `CollectionDescription` and their utilities and tests. Parity proof in `test/layout/shell-parity.test.ts`.
- M8 (this branch): handbook rewritten for the two tabs in both editions (new chapters `automations` and `decisions`, secrets by form, file or OpenApe Secrets, creation only through Codex, navigation through the gear and account menus); runtime reference names `view=map` and `requestSecret`; `docs/graphs.md` reads networks on the map; `e2e/handbook-capture.test.ts` follows the new navigation. M9 (signed release, relay deploy, acceptance) is an owner gate.
