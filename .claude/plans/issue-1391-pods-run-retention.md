# Plan: Pods run retention and one signed desktop release

<div class="callout callout-warn"><strong>Approved: policy B.</strong> Completed delivery receipts survive independently of pruned run history. Patrick approved implementation, release and installation on September 26.</div>
<div class="grid"><div class="card"><span class="badge badge-info">History preview</span><h3>Recent runs</h3><p>The newest 50 runs are retained. Runs needed for recovery or unfinished work remain protected. Completed receipts survive independently.</p></div><div class="card"><span class="badge badge-success">Release scope</span><h3>OpenApe Pods.app</h3><p>One signed DMG. Existing local and account Pods remain owner data. No examples, profile or runs are shipped.</p></div></div>

## Purpose / Big Picture

Keep the newest 50 runs per Pod, ordered by started_at descending with rowid descending as the deterministic tie-breaker. Delete older eligible runs from local and central history and remove their execution folders. Preserve protected runs, idempotency receipts, Pods, account copies, scripts, schedules, checkpoints, sources and claims. Ship one signed/notarized app-only DMG containing this change and the inventory cache from PR 143.

Owner authorization already covers installation, paired backup and irreversible pruning after the safety checks. Patrick approved policy B and this implementation/release plan after discussing durable Pod workspaces and independent application-managed receipts. Implementation merged via PR 144 at 9237c196. One signed/notarized app-only DMG is installed with paired rollback; release verification is recorded in docs/agents/active-work.md.

## Repository orientation

Canonical repository: https://repos.openape.ai/patrick/monorepo. Issue: https://repos.openape.ai/patrick/monorepo/issues/1391. Context: issue 1390 and merged PR 143. Dedicated checkout: /Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo.worktrees/pods-run-retention. Branch: feature/issue-1391-pods-run-retention. Starting main: d4adc04afd529b9abe432241748408278a722dac.

TypeScript, Electron, Vue and SQLite (node:sqlite); existing Vitest suites. Before every pnpm shell, put /Users/patrickhofmann/Companies/private/repos/openape/.toolchains/pnpm/10.29.3/bin on PATH and source ./scripts/activate-node.sh. Frozen dependencies and the CLI auth build are installed. Use pnpm git:cli for all forge operations.

## Safety discovery and owner decision

Read-only owner-profile queries on September 26 found 26 completed effect receipts on 21 runs, with 15 receipt-owning runs outside the newest 50: zaz 1, IURIO PR monitor 5, Mail-Kurzbericht 9. There were no intent/unknown effects or workflow runs. All five retryQueued recovery reviews point to processed request events. One finished run still has a latest pending approval event and must remain protected unless the normal approval lifecycle explicitly resolves it. Counts move while the app runs and must be remeasured before installation.

The effect_ledger schema has run_id TEXT NOT NULL REFERENCES runs(id), with PRIMARY KEY(pod_id,effect_key). Deleting the receipt breaks idempotency; deleting its run while retaining it violates the FK. Two valid choices:

- A (considered, not selected): retain every receipt-owning run in addition to the newest 50. No ledger migration; receipts remain byte-for-byte unchanged. Current lower bounds become zaz 51, IURIO PR monitor 55 and Mail-Kurzbericht 59, plus other genuinely protected runs. This does not prevent pruning the frequent zaz Pod: only one of approximately 1,359 older zaz runs has receipts. This policy can exceed 50 indefinitely if future runs each create receipts, and the UI/docs must say so.
- B (approved): detach completed receipts from run history with an explicit schema migration (nullable FK or dedicated durable receipt storage). Preserve pod/effect key, operation, input hash and result; retain intent/unknown runs. Audit central restoration, backup/schema compatibility and mail workflow receipt joins. This allows old completed receipt runs to disappear but expands migration and release risk. Preserve receipt values and idempotency semantics; only the obsolete run link becomes null.

Never resolve an open review, pending approval/input or unfinished workflow merely to meet the number. Any additional conflict discovered in implementation or preflight returns to Patrick before deletion.

## Run-reference map and intended disposition

| Reference | Current consumer / constraint | Retention behavior |
| --- | --- | --- |
| runs | runs/store.ts lists 100 by started_at,rowid; get requires row | Preserve newest 50 and protected rows; remove eligible old row |
| run_leases | FK; RunStore authority; recovery/reconcile.ts | Any lease protects the run regardless of heartbeat/boot |
| run_events | FK; approval state, timing, event history | Latest pending approval per grant protects even stopped runs; delete eligible run events |
| run_inputs | FK; reason and JSON event_ids | Check linked input states; delete eligible row |
| accepted_events | nullable run_id, no FK; scheduler dedupe uses pod/source/dedupe_key | Pending/claimed/blocked inputs protect associated run; preserve processed dedupe identity and its immutable payload without a run link (payload equality rejects conflicting retries); prove duplicate input cannot run again |
| execution_domains | FK and paths inside runs/id; recovery/domains.ts inspects execution | Do not delete unverified execution state; completed runs normally release lease only after execution cleanup; cover interrupted/legacy cases |
| recovery_reviews | FK; needsReview/ready/retryQueued and request_event_id | Protect unresolved review; consider retryQueued resolved only when linked request has settled successfully; test both sides |
| effect_ledger | NOT NULL FK; recovery/effects.ts begin reads by pod/effect_key | B: retain unresolved runs; detach completed receipts with a nullable FK guarded by a CHECK constraint |
| workflow_attempts | FK to run and workflow run, includes earlier retries | Protect every attempt of unfinished workflow, including historical attempts |
| workflow_nodes | nullable run FK; engine.ts, control/changes.ts, mail/workflow.ts | Only finished workflow history may detach a pruned run; preserve graph configuration and durable mail/checkpoint state |
| control_runs | non-null textual run_id, kind pod/workflow; no FK | Remove obsolete pod-run history reference without removing applied control_changes idempotency result; preserve workflow-kind IDs |
| control_changes / master action and chat results | serialized execution IDs and operation results | Audit serialized execution references; avoid showing deleted run history or enabling replay; preserve chat/configuration decision receipts |
| runs/id folder | runner domains, logs, script execution | Journal exact validated UUID; never delete pods/, snapshots/, scripts or profile root |
| mail/*.ts | workflow.ts joins effect_ledger to workflow_attempts; authorization checks active run/lease | Preserve delivery receipts, knowledge, mail scope cursors and processed-message identities; unfinished workflows protected |
| resources/registry.ts | oldest running started_at protects resource freshness | Running runs always protected |
| data/backup.ts | exports SQLite and durable files, excludes runs/ execution folders | Backup copy describes only retained history; paired install rollback must copy the entire profile |
| remote/control.ts, codex/control.ts, master/control.ts, workspace/scripts.ts | command/result forwarding and run views | Verify missing pruned-run response and no implicit execution replay |

Other file consumers include runs/dispatcher.ts, runner.ts, script-entry.ts, runs/http.ts, agent/executor.ts, workflows/handoff.ts, mail/authorization.ts, dependencies/install.ts and store.ts. Active-run protection preserves their paths and authority. Contract/renderer consumers must tolerate a run disappearing between list and detail reads.

## Central history

CentralProjection.snapshot in src/worker/central/projection.ts exports ALL centralTables rows, including runs, events, inputs, accepted events, receipts, workflow and control history. The displayed run list being capped at 100 does not bound the archive. Local deletion must therefore update both run rows and related references.

src/main/central/controller.ts detects changed worker data, rebuilds snapshots and emits null manifest entries for removed parts. Relay workspace-store.ts storeSnapshot deletes absent keys for format 1; publishParts deletes explicit null keys for format 2 and commits the replacement manifest. commitPublication clears staged parts; format 2 stores snapshot=null. The relay reads only IDs in the current Pod part and rejects absent run IDs. No relay behavior change is expected, but an existing relay suite must prove the publication removes list/detail/archive parts while preserving Pod/account data. Update relay and deploy it first only if that proof requires production changes.

## Milestone 1: bounded crash-safe retention

Extend worker/data/retention.ts and database.ts with an explicit run-only cleanup journal. Do not reuse the pod-deletion cleanup blindly: it deletes Pod folders, snapshots and dependencies. Commit run-history deletion and cleanup job insertion in the same transaction. Recover pending jobs at startup through the existing cleanup entry point. Validate journal paths/IDs. Remove cache entries for pruned runs.

Keep the top 50 over all runs, then exempt protected older rows. Require a finished non-running run. Bound each pass (initial target: 25 runs) and file cleanup work, and prevent overlapping cleanup after tickStep timeout. Reuse the existing scheduler cadence and tickStep; no timer. Index candidate/protection queries where measurements justify it. Retry filesystem errors from the journal and expose them without losing work.

Acceptance: 55 eligible completed runs become the newest 50 rows and folders; tie ordering is deterministic; unfinished runs and each protection survive; removing the corresponding protection permits pruning; effects replay returns its original receipt without another HTTP delivery. DB interruption rolls back; file interruption leaves a journal recovered on reopen. Foreign-key check stays clean. Scheduler makes progress while retention drains a large backlog.

## Milestone 2: UI, documentation and central behavior

Update DataManagement.vue, src/i18n/de.json and README data/retention text to explain newest 50 plus protected history, receipt policy and irreversible removal. Keep examples and mail recipes strictly opt-in on existing Pods. Extend existing data/ui.test.ts component assertions in both languages. Adjust run-detail handling only where necessary for concurrent deletion.

Extend test/data/backup.test.ts, test/runs.test.ts, test/recovery/effects.test.ts, test/scheduling/workflows.test.ts and existing central tests. Keep permanent regression tests for destructive retention, receipt replay and protection contracts; no runner/script/default-chain changes. Test central format-2 list/detail/archive removal and account Pod preservation in the existing relay workspace-store suite. Add no fixture profile to distribution inputs.

Acceptance gates in order: pnpm lint; pnpm typecheck; pnpm turbo run build --filter=@openape/pods; focused existing Vitest suites and component suites. If relay changes, run its build/tests. Capture bounded-pass time and rows/files before and after on synthetic data, with negative controls for every protection.

## Milestone 3: native PR and merge

Update docs/agents/active-work.md with issue, branch, SHA, checks and next step. Commit English Conventional Commits at most 80 characters. Push canonical branch through existing hooks. Create native PR with measurements, receipt decision and permanent-test justification; link issue 1391 explicitly. Review full diff and exact source/target SHAs. Wait for all required exact-head CI and a green main before native merge. Do not close issues at merge.

## Milestone 4: one app-only signed release

Use a clean worktree at merged main. If relay production changes are needed, deploy current clean main with pnpm deploy:image pods-relay --dry-run then actual deployment immediately before desktop installation. Run pnpm install --frozen-lockfile, pnpm check:ci and pnpm --filter @openape/pods build.

Before signing, inspect Contents/Resources and app.asar for control.sqlite, profile/fixture data, pods/ or runs/ user-data directories. Source code with these concepts is not user data. Build only the application; never seed, import or create owner Pods.

From apps/openape-pods use OPENAPE_PODS_SIGNING_IDENTITY='Developer ID Application: Delta Mind GmbH (Q994DN23WB)' OPENAPE_PODS_NOTARY_PROFILE=delta-mind-notary pnpm exec node scripts/package.mjs --distribution --signed-local. Run pnpm test:distribution --signed-local with display awake; check pmset and screencapture, use caffeinate -u -t 600 if needed. Read visual-verification.md before screenshot capture and inspect .artifacts/data-dmg.png. Acceptance fixtures use only the isolated test profile. Mount the DMG read-only and repeat the data-exclusion check. Record SHA-256 and signing/notarization evidence.

## Milestone 5: paired backup, install and verification

Immediately before replacement read control.sqlite with readOnly only. Record Pod IDs/names, per-Pod runs, schema, schedule configuration hash (exclude normal next_at advancement), next schedule times, complete receipt hash/count, run folder count/entry count and data_settings.error. Confirm run_leases empty; recheck next schedule gap. Quit normally using the app's verified bundle ID. Never kill by name; other Codex MCP processes may share the bundle.

Create ~/Library/Application Support/OpenApe Pods Rollback/<YYYY-MM-DD-HHMMSS>-issue-1391/. Move the old app there and copy the full profile via cp -cR. Install only the mounted app using ditto into ~/Applications. Verify codesign --verify --deep --strict and spctl --assess with Notarized Developer ID, then launch normally.

Observe convergence of bounded cleanup. Assert same local/account Pod identities without duplicates, unchanged schedule configuration, no data error, successful next scheduled runs, newest 50 plus precisely identified protected runs, folders reconciled against rows/journal, and unchanged effect identity/hash/state/result values under policy B, with only pruned run references changed to null. Retention must not seed account content or mutate Pod definitions. Compare entry counts. Measure the NodeService helper whose parent is the app main process using ps -o time= over five minutes; retain start/end values and PID/parent evidence. Baseline: 14.5 CPU seconds/5 minutes on 9f00ed4d, with IURIO Task monitor cadence changed from one to five minutes since then.

Record DMG hash, backup path, before/after counts, folder entries and CPU in both PRs and docs/agents/active-work.md through a follow-up native PR if needed. Close issues 1390 and 1391 manually with explicit verified evidence. Do not claim completion until installation and scheduled operation have been observed.

Rollback: quit normally, preserve the post-upgrade profile for investigation, restore the paired previous app/profile together. The old app must never open a newer schema. No rollback can recreate pruned history without that paired backup.

## Progress

- September 26: dedicated main worktree created; AGENTS and the three requested memory notes read; dependencies/CLI prepared.
- September 26: issue 1391 opened before coding; source references and read-only receipt inventory inspected.
- September 26: Patrick approved policy B and the plan. Implemented bounded retention and nullable completed-receipt references. Full lint/typecheck, Pods build and all 542 tests pass. Native PR 144 and exact-head CI passed; signed merge-commit release installed with paired rollback.

## Surprises & Discoveries

- effect receipts protect relatively few existing runs; retaining every receipt-owning run adds only one old zaz run today, but has no long-term numerical bound.
- Central archive contains all DB run rows despite a 100-run displayed list; removing only UI rows would leave the account copy unbounded.
- Pod deletion's cleanup removes far more than run history; it must never be invoked with a run-only job interpreted as a Pod deletion.

## Decision Log

| Date | Decision | Reason |
| --- | --- | --- |
| September 26 | Owner authorized newest 50, protective exceptions and paired-backup installation | User request |
| September 26 | Patrick approved policy B | Durable application-managed receipts are independent of disposable run history |

## Session checklist

Read this plan and current active-work, inspect branch/status/log and canonical main, rerun live inventory before installation, continue only approved milestones, keep evidence and progress current. Do not touch parallel worktrees or owner Pod code.

## Outcomes

DMG SHA-256: `2331cf7b10554ef9324e695d32448eab0a37380bd79fa688335a19d5282b87c8`. Paired rollback: `/Users/patrickhofmann/Library/Application Support/OpenApe Pods Rollback/2026-09-26-103952-issue-1391/`. Before/after entries under runs/: 34,799 → 2,808. Gatekeeper confirms Notarized Developer ID; signed DMG acceptance and inspected screenshot passed. No owner Pods or profile data were included or seeded.

Implementation and installed release are verified. Benchmark: 2,500 runs and 30,000 files reduced to 50 runs/folders in 98 bounded passes; maximum 17.42 ms, mean 14.04 ms, idle pass mean 0.117 ms, zero foreign-key errors. Release and installation completed at 9237c196; live rows/folders reduced from 2,560 to 258, preserving all 12 Pods, schedules and 26 receipts. Worker CPU measured 4.80 seconds per five minutes versus 10.69 immediately before. One old approval-protected run remains outside the newest 50. See docs/agents/active-work.md for hashes, backup, central checks and scheduled-run evidence.
