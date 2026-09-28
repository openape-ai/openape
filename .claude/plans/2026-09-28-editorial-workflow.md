# Plan: Morning briefing editorial workflow

## Purpose / Big Picture

Patrick receives the same private German morning report and Telegram link. Dedicated Pods own source collection, editorial prose and publication. An editorial preview can reuse frozen input without rereading mail or delivering anything. Patrick approved this decomposition on September 28 with “super - bau das so um”. This plan makes that approved scope executable; it does not request a second approval.

Scope: four nodes in the existing workflow, standalone example scripts, bounded typed handoffs, saved editorial input, native resource setup, tests, canonical PR and an actual no-send preview. No additional Telegram test messages, generator schedules, private-report backend or arbitrary HTML. Keep the existing report renderer and server contract. Do not change mail protection or approval policy.

## Repository orientation

- Canonical repository: https://repos.openape.ai/patrick/monorepo.git. Issue: https://repos.openape.ai/patrick/monorepo/issues/1400.
- Own checkout: `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo.worktrees/reports`; branch `feature/issue-1400-editorial-workflow`; canonical baseline `f60c762a` (PR 163). Preserve other sessions and the clean `reports-release` checkout.
- Relevant sources: `apps/openape-pods/examples/mail-triage.mjs` (`reviewImportant`, `run`), `examples/morning-mail-briefing.mjs` (`buildBriefing`, `run`, `publish`), new source/editorial examples, existing `test/mail/briefing.test.ts` and Reports publication tests. Runtime handoff contract: `src/contracts/workflows.ts`, `src/worker/workflows/handoff.ts`.
- JavaScript ES modules run in the installed Pods sandbox. Scripts remain self-contained; no package/runtime change is planned. Existing Vitest infrastructure handles regression coverage.
- Each shell: prepend `/Users/patrickhofmann/Companies/private/repos/openape/.toolchains/pnpm/10.29.3/bin` to PATH, then `. ./scripts/activate-node.sh`. Baseline `pnpm run doctor`; checks `pnpm lint`, `pnpm typecheck`, `pnpm --filter @openape/pods build`, `pnpm --filter @openape/pods test`. Use existing manual browser tests only if UI changes warrant them. Native PR and exact-source external CI are mandatory.

## Architecture and contracts

Existing owning workflow `5f7ea0d7-1f9c-4c74-8c8a-afd513950001`, revision 7 after accepted cutover, daily 07:00 Europe/Vienna:

1. Existing Mail-Prüfung Pod `890bca63-dc4d-4e93-a5cc-cc8c7bfe489d`: Inbox/protection reads, fresh selected conversations including sent replies, bounded Jev classification, archive proposals. It emits evidence and fixed action eligibility, without editorial LLM calls. Its independent 60-second approval poll remains intact.
2. New Calendar/Issues source Pod: the existing calendar and owned-repository issue collection, no model, report publication or Telegram. It has no independent schedule. Reuse the existing approved readers and account scopes. Existing Microsoft Pod credential folder may be assigned; do not copy owner login stores. Patrick separately confirmed transferring the existing Repos login/signing state into the isolated source assignment. Use supported private-file import and the established bootstrap wrapper; remove temporary imports. This targeted approval does not authorize other owner credential copies.
3. New Berichtsredaktion Pod: depends on both sources; no provider tools, credentials or delivery authority. It uses `agent.run` with tools empty to write German summaries, evidenced next actions and an overview. Disposition is fixed by the source review: keep/partial evidence cannot turn into an owner action. Preserve original subjects, source URLs, calendar and issue facts. Validate model output before accepting it.
4. Existing sender `991849f7-b612-4cf9-8201-5b78b4a12e55`: depends only on the editorial output, validates identity/date/freshness/schema, binds the configured series and freezes the payload before publication. It retains its checkpoint, daily Telegram key, receipts and uncertain-effect blocking. No collection or model calls on this path.

Workflow outputs are immutable and limited to 65,536 characters. Mail evidence may exceed that bound: write an atomic immutable per-workflow snapshot to a dedicated owner-assigned evidence directory outside protected application storage. Handoff only the versioned schema, workflow/date, relative snapshot name, byte size and SHA-256 digest. Assign the editorial Pod read access to that specific directory. It verifies the exact allowed path, digest, size, date and workflow identity. No broad home access or credentials in snapshots. Calendar/issue handoff is bounded JSON. Reject ambiguous/missing predecessors and stale or substituted input.

The editorial Pod saves its assembled input under its own private workspace before inference. A manual replay selects an exact stored workflow ID, runs only the editor and writes a local preview; it does not invoke providers, publish or send. Live workflow runs always use fresh predecessor output. Source content remains untrusted data throughout.

The editor hands off a versioned structured briefing without authority to choose the owner or delivery destination. The sender sets the live/preview series, validates the report boundary and preserves deterministic frozen publication retries. Already delivered dates still stop before Telegram. Failed editorial validation stops the workflow before publication. Source gaps retain their explicit labels.

## Milestones

### M1: Source and editorial contracts

Goal: source evidence and editorial prose are separate and repeatable.

Steps: inspect live resources, scripts and workflow; record a rollback snapshot without secrets; refactor mail review into evidence production; implement source and editorial scripts, bounded handoffs and saved-input replay. Retain original archive checks.

Acceptance: existing and extended mail tests prove fresh sent context, remaining promises, partial evidence, digest/path mismatch, stale input, absent predecessors, malformed/injected model output and replay with zero provider/publication calls. German prose has one entry per selected conversation. No new runner or default test chain.

Rollback: no live scripts change during implementation; source revert through PR if needed.

### M2: Publication integration and native setup

Goal: the existing sender consumes only validated editorial output while preserving delivery state.

Steps: adapt sender; preserve publish/receipt/retry logic; create new source/editor Pods with no schedules; assign only required source reads and the editor snapshot directory. Use supported draft/validate/activate operations and fresh revisions. Verify authentication through actual native reads; synthetic validation is not access evidence.

Acceptance: original idempotency/failure tests pass; missing/invalid/stale editorial output cannot publish or send; a retry preserves frozen bytes. Sender ID, last delivery 243, live series `01M3J0X2MA3M468QP4121WGXV9`, slug `BSpWAZQkzQTTTOMU1qZ303zv`, owner/privacy contract and existing receipts remain unchanged.

Rollback: retain original scripts (`mail 337eccf9ece42607cc3c615d37bea0ac2ab960ca719cfc24e7eea8ffc935f282`, `sender 93d46497ab1e058de8da5f6482119f4f950fd551b974e36453edc2a97201b040`) and workflow revision-6 definition. Restore through supported version/revision APIs; never delete or rewrite checkpoints/effects. Pause unused new nodes if rolling back.

### M3: Merge, actual preview and cutover

Goal: the four-node workflow works on real current sources without another Telegram message.

Steps: native PR, reviewed exact source/target and external CI. Update the existing workflow atomically after node validation. Keep its only daily schedule and preserve the mail approval poll; sender/source/editor independent schedules stay disabled. Daily action website stays paused. Today's live and preview editions already exist and are immutable: create a dedicated owner-private migration preview series/binding, use it only for acceptance, and retain its receipt. No public proof report may contain real mail/calendar data.

Acceptance: actual manual workflow completes all four nodes; source/editor/publication receipts agree; editor-only replay does not reread sources or publish. Inspect the private published page directly and verify owner access/anonymous denial. Exactly zero Telegram POSTs; message 243 and delivered date remain unchanged; no archive grant consumed in preview. Restore the standard preview configuration afterward. Document installation and preview acceptance separately from the next future regular delivery.

Rollback: restore the old two-node workflow and old scripts, preserving pending state and the daily schedule. Do not replay uncertain effects. Reports server is unchanged at `prod-7bab2ba6`; minimum safe rollback stays `prod-183395e4` while private data exists.

## Progress

- [x] 2026-09-28: Owner approved the decomposition; current main, runtime, two live script hashes, delivery checkpoint 24 and workflow revision 6 inspected.
- [x] M1: contracts and script separation; 31 focused contract tests, full lint/typecheck, app build and 623 unit tests passed.
- [x] M2: sender integration and native source/editor setup.
- [x] M3: canonical merge, actual no-send preview/replay, final workflow and receipt verification.

## Surprises & Discoveries

- Workflow handoffs contain only direct predecessors and cap serialized output at 65,536 characters. Long mail evidence needs a private immutable snapshot reference, not silent truncation or global runtime-limit changes.
- Native directory assignment rejects other Pods' protected workspaces. Evidence therefore uses `/Users/patrickhofmann/Library/Application Support/OpenApe Briefing Evidence/mail`, assigned read/write only to mail and read-only to editorial.
- New program assignments have isolated encrypted authentication state. Reusing an executable does not reuse its provider login. The owner explicitly confirmed a targeted private-file import for this source assignment. Native reads and forced renewal passed; temporary imports were removed.

## Decision Log

| Date | Decision | Reason | Alternative rejected |
| --- | --- | --- | --- |
| 2026-09-28 | Retain sender identity and checkpoint | Preserve delivery receipts/recovery and the browser opener's receipt path | New sender with empty delivery history |
| 2026-09-28 | Dedicated source/editor nodes without schedules | One owning workflow, testable boundaries | More daily independent jobs |
| 2026-09-28 | Fixed action eligibility plus tool-free editorial prose | Preserve evidence/approval rules while moving writing to its own Pod | Letting prose silently change archival or action decisions |

## Session checklist

Read this plan and current instructions; inspect Git/live revisions; run baseline; implement next incomplete milestone; run relevant gates; keep source and deployment evidence distinct; update plan, native issue and existing vault note.

## Outcomes & Retrospective

[Issue 1400](https://repos.openape.ai/patrick/monorepo/issues/1400), [PR 164](https://repos.openape.ai/patrick/monorepo/pulls/164), [approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3KEEMTW4EN59AFD8HP34X7F). Implementation merged as `0b8216bb1b17269bbaa5c1d03cb919ee45b87fae` after exact-source CI 5201. Full lint/typecheck, Pods build and 623 unit tests passed; the clean merged deployment gate `pnpm check:ci` passed (`1790582152595-0b8216bb-unit/summary.json`).

The existing workflow is active at revision 7, daily 07:00 Europe/Vienna. Mail evidence and Calendar/Issues collection feed the dedicated German editorial Pod; the existing sender consumes only its validated report. New source Pod `51832859-53e0-4cbc-a44c-61ad76aad931` and editorial Pod `6c9d0c12-32fa-4d56-a84a-9a035a030914` are active without independent schedules. The mail approval poll remains enabled every 60 seconds; the sender schedule remains disabled and Daily action website remains paused. Reports server stays at `prod-7bab2ba6`.

Actual manual workflow `e6e4d970-e88a-4857-a7d2-e1b0c94ac6a8` completed all four nodes. Private preview publication `01M3KGPJA9V7B7SWKB9Y2VTDWG`, version 1, digest `48a9b702a3312c64b221f9de1c815eda230b71d2f07f0966bf0acd732b99d48c` matches the frozen payload and server receipt. Editor-only replay `59f48f07-ad72-4b21-8370-a4ecc491af11` completed using its saved input, with only agent operations and no provider, publication or delivery operations. Preview sender has one completed Reports effect and zero Telegram POSTs. Sender checkpoint 26 retains message 243 and September 28 delivery, with no pending operation. No archive grant was created or consumed by the preview.

Owner latest/dated API access and anonymous page/API/asset/publication denial pass on both domains. German copy and consolidated mail cards were inspected directly in Firefox at desktop and 390×844 mobile size. The answered MIAS conversation has no next action. Standard preview series was restored and the temporary replay selector removed; final scripts were revalidated. The next regular delivery is September 29 at 07:00; this manual preview does not prove that future delivery.

Patrick explicitly confirmed the targeted Repos authentication transfer for the new source Pod. Supported private-file `program importState` plus the existing bootstrap pattern initialized only that isolated program's login/signing state; temporary import files were removed. Actual native source reads succeeded for both calendars and owned issues, including forced token renewal. The source remains limited to calendar and issue reads. Editorial receives only its read-only evidence directory and no provider or delivery capability.
