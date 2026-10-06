# Plan: Central execution recovery without permanent failure locks

## Purpose / Big Picture
Owner request on October 5, 2026: solve execution failures permanently in the central runtime so one problem does not leave a Pod unable to run. A failed attempt must remain observable without becoming an indefinite Pod-wide latch. The owner has authorized this objective; the owner approved this concrete plan on October 5, 2026. Implementation and installed acceptance are complete.

User-visible outcome: active scheduled monitors continue at their next eligible interval after an ordinary failure or safe shutdown. Transient work retries automatically with bounded backoff. Only a specific unresolved external outcome or unverified running process requires review. Standing runtime grants remain independent of action grants. No recipe-specific try/catch patches and no owner-facing opt-in are needed for normal recovery.

Review copy: https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M45PKJ4JQAX647R6ZND47A1J

## Repository orientation
Canonical repository: https://repos.openape.ai/patrick/monorepo. Issue: https://repos.openape.ai/patrick/monorepo/issues/1423. Inspected canonical main and installed source: 5fb7b4bd44804f1636c63e9dea22b7bb11437f31. Checkout: /Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo.worktrees/pods-standing-runtime. Implementation branch: feature/issue-1423-central-recovery. The installed app is /Users/patrickhofmann/Applications/OpenApe Pods.app; its profile is ~/Library/Application Support/OpenApe Pods. Never modify production SQLite rows directly.

Relevant components under apps/openape-pods/src: worker/runs/dispatcher.ts classifies service errors, cancellation and shutdown; worker/runs/store.ts settles attempts and accepted inputs; worker/scheduling/scheduler.ts admits later work; worker/recovery/reconcile.ts and domains.ts verify recovery and terminated process domains; worker/recovery/effects.ts and worker/runs/http.ts retain external-operation receipts; worker/scheduling/network-recovery.ts and workflow/network dispatchers own case and dependency receipts. worker/entry.ts routes trusted commands. Shared contracts, storage migrations, backup/restore and desktop/relay projections must agree on every durable state.

Current behavior verified in source and production: finishOwned marks unfinished claimed inputs blocked. Scheduler.drain excludes an entire Pod if any accepted input is blocked or claimed. Automatic infrastructure requeue requires no abort, no script start, no process/effect record, unchanged checkpoint and unchanged binding. Existing tests explicitly reject automatic restart after any process, checkpoint or effect work. App shutdown aborts with Application is quitting. IURIO Task monitor 92d70bae-c6ad-4d21-8180-605d7d8b7ede has one blocked input tied to cancelled run 811f8ede-c8f4-4b7c-9790-483553bf6966 from September30 12:43 CEST; its runtime/task-list grants were approved and that run has no effect-ledger record. One later scheduled input is pending and the 300-second schedule remains enabled.

## Central behavioral contract
A run result, the disposition of its input, and evidence of an external effect are separate concepts. Failed remains failed in history. Unfinished work is never relabelled successful merely to clear a queue. Absence of a receipt is not proof of safe replay if legacy operation evidence is incomplete.

| Situation | Central behavior |
| --- | --- |
| Ordinary script failure, temporary read/service error, or timeout without unresolved effects | Preserve diagnostics; allow later scheduled work. Retry recoverable original work with backoff and unchanged authorization checks. A process having started is not by itself a safety hold. |
| Clean shutdown or worker interruption | Prove the old process domain has stopped; recover automatically from committed state when operation evidence permits it. Startup must not require a manual reset for this ordinary lifecycle event. |
| Repeated programming/data error | Avoid an immediate retry loop. A recurring monitor retries at the regular eligible interval; a durable event is retried a bounded number of times and then isolated with its failure evidence. Unrelated independent inputs remain eligible. |
| Known completed effect with an existing durable receipt | Reuse the receipt for replay of that logical action. Do not send again. Completed effects or checkpoint changes alone are not grounds for an indefinite Pod lock; resume against the committed state. |
| External delivery may have happened but lacks a conclusive receipt | Hold that logical action and dependent work for reconciliation. Never infer non-delivery from a timeout, exception or HTTP500. An unresolved operation cannot be bypassed with a new random key or newer input. |
| Previous execution cannot be proven stopped | Retain the execution lease/safety hold until termination is verified. Never create overlapping writers to the same Pod state. |
| Explicit user pause, cancelled manual attempt, denied/revoked grant, changed binding or restored baseline requiring review | Preserve the owner's decision and the existing authority boundary. Do not retry a manually cancelled attempt immediately. A one-run cancellation does not silently disable an otherwise enabled future schedule. A paused Pod stays paused. No replacement grant is auto-approved to bypass refusal. |

Safety holds attach to the smallest provable scope: logical effect, input batch, workflow dependency or execution domain. A shared checkpoint can make later work dependent on an unresolved action; in that case it must wait too, with a concrete explanation. This plan does not promise that arbitrary scripts can be replayed without receipts or that exactly-once delivery can be manufactured for an external provider.

Scheduled ticks represent recurring observations and must coalesce rather than accumulate replay storms after downtime. Durable external inputs remain individually accounted for; do not drop mail, jobs or workflow items. Keep the original batch identity and checkpoint contract during retries. Do not infer independence from arbitrary script text or user-provided data. Use validated broker/operation contracts and stored evidence.

## Milestone 1: Shared recovery decision and durable accounting
Introduce one small typed recovery decision at the run/operation boundary, reused by standalone, workflow and network adapters. Separate shutdown, owner cancellation, authority refusal, ordinary failure, retryable infrastructure and uncertain external outcome. Do not classify by English error substrings. Record recovery reasons, attempts and next eligibility durably using the existing storage infrastructure and additive migrations where needed.

Retain actual operation evidence before execution and on settlement so a shutdown can distinguish read-only work from an ambiguous external mutation. Use existing effect receipts and broker-validated read contracts. Do not make broad arbitrary-shell replay assumptions. Model inference retries must retain their existing budget and response semantics. Preserve idempotency input conflicts, known applied receipts and grant references during pruning and backup/restore.

Acceptance: behavioral tests distinguish failed execution from input completion and review-required evidence. Ordinary post-start read failures and clean shutdown are eligible for recovery, while an unknown send or unverified process remains held. Completed receipts are reused without duplicate effects. No grant or lifecycle state is broadened.

## Milestone 2: Central admission, retries and historical recovery
Replace the blanket any-blocked-input Pod exclusion with admission based on actual dependencies and recovery evidence. Apply the same decision to standalone schedules, durable event intake, sequence workflows and network invocations; preserve each domain's ordering, case identity, fairness, one-writer and claim/lease contracts. Do not rewrite these schedulers into one new framework.

Transient retries use persisted bounded backoff (start at2 seconds, cap at60 seconds, preserve existing retry-after lower bounds). Limit immediate attempts to5 before returning periodic monitors to their next regular interval; durable event failures remain recorded for later retry/review rather than silently disappearing. Coalesce scheduled ticks and repeated UI diagnostics. A poison input must not block unrelated independent cases. Dependent workflow nodes wait for successful prerequisites; failure is not a fabricated success output.

Run an idempotent startup reconciliation for legacy blocked/claimed records. Use current authority, original batch/checkpoint references, operation evidence and stopped-domain proof. Automatically release recoverable historic shutdown/read cases such as the IURIO monitor. Keep uncertain cases with a specific remaining reason; never bulk-clear blocked rows. Startup reconciliation must be restart-safe and bounded so it cannot stall the scheduler.

Acceptance: an active Pod with the historical IURIO shape resumes without owner intervention; a failed scheduled run is followed by an eligible successful run; restart during recovery cannot duplicate a claim or completed effect; repeated errors do not spin or grow the queue without bound; pause, revoked grants, changed bindings, restore review and dependent workflow order still hold. Independent network cases continue while one unresolved delivery retains its receipt.

## Milestone 3: Honest desktop and shared status
Update existing recovery/status projections and controls to show the actual state: failed last run with next execution, retrying at a known time, or a named operation requiring review. Show only actionable manual recovery controls. Keep the historical attempt/error visible. Desktop, central workspace and MCP must explain the same condition. Update handbook and translations. Do not introduce a permanent user preference that leaves existing monitors on the broken behavior.

Acceptance: component tests cover visible state and actions. Use the established browser suite for actual layout and inspect screenshots. An ordinary error must not render as a permanently blocked Pod. A real review condition must identify what is unknown and which work depends on it.

## Milestone 4: Verified delivery and installed acceptance
Use Node24.15.0 and pinned pnpm10.29.3. In each shell prepend /Users/patrickhofmann/Companies/private/repos/openape/.toolchains/pnpm/10.29.3/bin to PATH, then run . ./scripts/activate-node.sh. Run pnpm run doctor. Before adding tests inspect existing suites: test/scheduling/scheduler.test.ts, test/recovery/effects.test.ts, test/recovery/ui.test.ts, worker-entry/dispatcher suites, network/workflow suites and test/data/backup.test.ts. Extend these suites; do not add a runner or alter the default test chain.

Retain permanent tests for interrupted execution, independent input progress, durable migrations, grant refusal and exactly-once receipt reuse because these are consequential contracts. Run full pnpm lint, pnpm typecheck, pnpm --filter @openape/pods build, focused behavioral suites and pnpm check:ci --suite unit. Add targeted relay checks/build only if its shared projection changes. Use an isolated fault-injection fixture to observe timeout, shutdown, read failure and unknown-send behavior end to end. Never send a real message just to verify a failure boundary.

Create native PRs linked explicitly to issue1423; inspect exact source/target diffs and require exact-source CI before merge and full main CI before installation. Build from clean merged canonical source; sign/notarize through the existing signed-local path and run pnpm --filter @openape/pods test:distribution --signed-local. If projection/schema changes require a relay release, deploy the compatible relay first using the tested-image workflow. Do not register a new runtime or reset production identities.

Take a consistent protected backup of the stopped profile and prior app, verify bytes, preserve Pod/script/resource/schedule/credential/grant bindings, and install the verified app. Observe automatic recovery of the already-enabled IURIO Task monitor and later scheduled execution without manually editing its queue or script. Existing configured notification behavior can resume normally; acceptance must not fabricate messages or alter recipients. Preserve all paused networks and monitors. Publish actual CLI/backend results and personally inspected screenshots in private OpenApe Reports under Test Runs; verify returned category/link. Close issue1423 and mark the plan done only after delivery and observable recovery.

## Rollback
Keep the prior signed app and a consistent pre-upgrade profile backup. Prefer a forward fix. Additive migrations and unknown-state handling must fail closed in older clients; never install an older binary over a profile it cannot understand. If restoration is necessary, assess remote grants/rotated sessions and reconcile work completed since backup before restoring: do not replay confirmed external deliveries or restore stale credentials blindly. A rollback must never clear unknown effect evidence. The existing all-Pods standing consent and action grants remain separate.

## Progress
- Completed October 5: PR237 / 062143d2 delivered; exact-source/main CI5393/5394 passed. Signed desktop/schema37 and compatible relay installed. Automatic IURIO recovery, catch-up and regular five-minute follow-up completed; verified private evidence: https://report.openape.ai/r/ktucXlYdTYlspg_QajaQz9TD.
- Implementation: persisted recovery decisions use the existing run event journal and retry fields; schema 37 prevents older clients from interpreting the new terminal failed-input state. Typed broker authority errors cross the worker bridge. No dependency or test runner was added.
- Verification: root lint/typecheck, app build, 153 suites / 1,315 tests, and six browser layout checks passed. English/light and German/dark screenshots inspected. Delivery and production recovery are verified below.
- Network automatic retries retain the existing three-attempt durable limit (within the approved maximum of five); standalone/workflow attempts use five. This avoids replacing the network control table merely to broaden its retry budget.
- 2026-10-05: Owner approved the plan. Implementation started on feature/issue-1423-central-recovery.
- 2026-10-05: Owner requested central elimination of indefinite failure locks. Inspected canonical/installed5fb7b4bd and actual IURIO failure state. Issue1423 created. Concrete implementation plan drafted; approval pending. No production recovery mutation or implementation change has been made for this task.

## Surprises & Discoveries
- The existing permanent tests intentionally prohibit retries after any process/effect/checkpoint work, explaining why the earlier infrastructure fix did not cover ordinary shutdown after script start.
- HTTP effects retain unknown outcome after error responses. Broadly converting every exception or HTTP error into safe retry would remove duplicate-delivery protection.

## Decision Log
- Central runtime policy and existing scheduler adapters; no per-Pod scripts, no blanket removal of leases or effect receipts.
- Separate failed history, durable input accounting and concrete safety evidence. Remove generic failure latching; preserve only justified dependency holds.
- Reconcile historical blocks through the same policy so installation fixes existing affected monitors as well as new runs.

## Outcomes & Retrospective
PR237 merged as `062143d2e41aed0f3dad860a3898e94910fc1b73`; exact-source CI5393 and full main CI5394 passed. Signed-local desktop0.1.2/schema37 and relay `prod-062143d2` are delivered. Root lint/typecheck, app build, 1,315 Pods tests, six browser checks, full repository unit checks and mounted signed-DMG acceptance passed. App and DMG are notarized, stapled and Gatekeeper accepted. [Verified private Test Runs](https://report.openape.ai/r/ktucXlYdTYlspg_QajaQz9TD) includes installed screenshots and actual backend receipts.

IURIO Task monitor resumed its September30 shutdown automatically at12:33:16CEST, using the original accepted input and existing runtime/read grants. It reported12 real changes through its separate existing Telegram grant, with one completed HTTP receipt. Catch-up at12:33:41 and regular schedule at12:37:56 both completed with204 unchanged tasks and no additional message. There are zero blocked inputs and no approval wait. No manual retry, queue edit or script change was used.

All38 stored Pods,70 resources,81 scripts, seven schedule definitions,86 permanent credential IDs and exact assignment/network bindings remain. Standing consent was verified checked and byte-identical. Credential ciphertext refresh and temporary broker files are expected runtime activity, not byte-preservation claims. The eleven-member network stays paused at revision2. Protected paired backup: `/Users/patrickhofmann/Library/Application Support/OpenApe Pods Rollback/20261005-central-recovery-1423` (2,271 app entries,15,919 profile entries, all verified). The schema36 binary cannot read schema37; preserve newer effect receipts and rotating sessions during any separately assessed rollback.
