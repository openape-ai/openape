# Morning mail triage and explicit archive grants

## Purpose / Big Picture
The owner approved this implementation on September 26, 2026. The existing 07:00 Europe/Vienna morning briefing for Delta Mind and DOCPIT will show actionable mail summaries and links to concrete archive approvals. Each grant lists every message with mailbox, sender, subject, date, original link and reason. Approval authorizes only the immutable reviewed batch. No mail is moved during triage or merely because this implementation was approved.

## Repository orientation
Canonical repository: https://repos.openape.ai/patrick/monorepo. Issue: https://repos.openape.ai/patrick/monorepo/issues/1395. Branch: feature/issue-1395-mail-briefing-grants. Base: bcccb19f7cbd3a33546a2b0e525395cfd2b58377. Checkout: /Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo.worktrees/mail-briefing-grants.

Pods is Electron, Vue, TypeScript and SQLite. Extend the existing script service bridge (`src/worker/runs/dispatcher.ts`, `src/main/worker.ts`) with a dedicated mail archive service. Keep generic program calls read-only. Store immutable batches and per-message execution receipts outside script-writable directories. Use existing IdP once grants, request summaries, signed authorization tokens and consumption; no new authorization protocol. A reviewed Microsoft companion program provides complete message identity/version/folder and immutable IDs. Existing workflow handoff carries the triage report to the briefing.

## Milestones
1. Archive contract and executor: prepare exact bounded batches from provider reads, publish human-readable grants, verify manual owner approval and token binding, consume once, recheck each message and retain outcomes. Refuse automatic grants, expired/stale batches, changes of application assignment, uncertain replay and duplicate execution. Tests extend Pods mail/program suites because incorrect authority could move unrelated mail.
2. Provider and recipe: assigned Microsoft helper with read/list/archive operations; tool-free semantic triage with conservative retain rules and full input validation. Poll pending approvals independently of daily classification. Publish dated workflow output; briefing shows explicit gaps, top actionable mails and grant links.
3. Delivery: relevant lint/typecheck/build/tests, native PR/exact-head CI, signed Pods build where required, preserve owner state, set up triage predecessor and the single briefing schedule. Preview actual sources without moving mail or sending an extra Telegram message; leave concrete mail grants to the owner. Verify next schedule, exact bindings and recovery behavior.

## Acceptance
- No movement before a manual once approval of the exact batch.
- Grant text includes every frozen mail and reason; source links are usable.
- New arrivals never enter a previously approved batch. Changed or moved mail is skipped.
- Crash/timeout leaves an explicit uncertain outcome; no blind repeat.
- Pending/denied/expired approvals do not delay the next briefing.
- Mailbox scopes remain Delta Mind and DOCPIT. General Pod reads remain read-only.
- The current calendar/issues sections and confirmed-delivery deduplication remain intact.

## Provider limitation
Graph does not document an atomic conditional move. The human-confirmed executor re-reads version and source folder immediately before a folder-scoped move and makes no atomic compare-and-move claim. The existing autonomous `conditionalMoveVerified=false` gate is unchanged. Microsoft references: https://learn.microsoft.com/en-us/graph/api/message-move?view=graph-rest-1.0 and https://learn.microsoft.com/en-us/graph/outlook-immutable-id.

## Rollback
Disable the new workflow and polling schedule, restore the original briefing script/resources and its existing daily schedule through supported APIs. Revoke pending archive grants. Preserve batch receipts and unknown outcomes; never restore an older data snapshot over newer mail effects. Revert product code through a native PR. No automatically executed move is authorized by a rollback.

## Progress
- 2026-09-26: Approved scope captured, issue and isolated checkout created. Existing workflow handoff and IdP summary/once-token mechanisms inspected. Implementation in progress.

## Decision log
- Human approval is per frozen archive batch, not a reusable move permission.
- Use the current Grant summary contract, avoiding a second approval surface.
- Keep the existing autonomous mail pilot disabled; add the separately reviewed human-confirmed path.
- Provider read and move failures remain explicit; successful prior effects are never silently replayed.

- 2026-09-26 17:19 Vienna: M1/M2 implementation complete; full lint/typecheck/build and 568 Pods checks pass. Real read-only Graph metadata probe passes. Native PR, signed delivery and live Pod setup remain.
