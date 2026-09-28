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

Existing owning workflow `5f7ea0d7-1f9c-4c74-8c8a-afd513950001`, currently revision 6, daily 07:00 Europe/Vienna:

1. Existing Mail-Prüfung Pod `890bca63-dc4d-4e93-a5cc-cc8c7bfe489d`: Inbox/protection reads, fresh selected conversations including sent replies, bounded Jev classification, archive proposals. It emits evidence and fixed action eligibility, without editorial LLM calls. Its independent 60-second approval poll remains intact.
2. New Calendar/Issues source Pod: the existing calendar and owned-repository issue collection, no model, report publication or Telegram. It has no independent schedule. Reuse the existing approved readers and account scopes. Existing Microsoft Pod credential folder may be assigned; do not copy owner login stores. Complete ordinary native program authentication if a new isolated application state needs it, or report the actual setup blocker without weakening isolation.
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
- [ ] M2: sender integration and native source/editor setup.
- [ ] M3: canonical merge, actual no-send preview/replay, final workflow and receipt verification.

## Surprises & Discoveries

- Workflow handoffs contain only direct predecessors and cap serialized output at 65,536 characters. Long mail evidence needs a private immutable snapshot reference, not silent truncation or global runtime-limit changes.
- Native directory assignment rejects other Pods' protected workspaces. Evidence therefore uses `/Users/patrickhofmann/Library/Application Support/OpenApe Briefing Evidence/mail`, assigned read/write only to mail and read-only to editorial.
- New program assignments have isolated encrypted authentication state. Reusing an executable does not reuse its provider login. Complete supported native setup; do not copy owner login stores.

## Decision Log

| Date | Decision | Reason | Alternative rejected |
| --- | --- | --- | --- |
| 2026-09-28 | Retain sender identity and checkpoint | Preserve delivery receipts/recovery and the browser opener's receipt path | New sender with empty delivery history |
| 2026-09-28 | Dedicated source/editor nodes without schedules | One owning workflow, testable boundaries | More daily independent jobs |
| 2026-09-28 | Fixed action eligibility plus tool-free editorial prose | Preserve evidence/approval rules while moving writing to its own Pod | Letting prose silently change archival or action decisions |

## Session checklist

Read this plan and current instructions; inspect Git/live revisions; run baseline; implement next incomplete milestone; run relevant gates; keep source and deployment evidence distinct; update plan, native issue and existing vault note.

## Outcomes & Retrospective

Pending implementation and actual native acceptance. Do not infer future scheduled delivery from a manual preview.
