# Plan: Central Chats for OpenApe Pods

<div class="callout callout-warn"><strong>Approved — implementation in progress.</strong> Patrick approved this plan on September 20, 2026: “Passt so. Leg los”. Product implementation and verification are authorized. Installation, live mailbox actions, Telegram delivery and schedule activation remain excluded. The retired Troop/OpenClaw automation remains paused.</div>

Review: https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2ZACGJKS6JHH84T22Q48K49

## Purpose / Big Picture

Give Patrick a visible Chats area for working on one Pod, several explicitly selected Pods, or one workflow and its member Pods. A request such as “Adjust the mail filter and the following short report together” produces reviewable saved work and evidence per Pod. Existing Pod conversations remain available with their original histories.

Use the existing MasterChat, SQLite store, script drafts, validation, approval surfaces, workflow engine and execution identities. Add conversation identity independently of context, context revision records, and a focused change-set coordinator. Do not create another agent runtime, scheduler, permission system or generic transaction framework.

Scope includes conversation listing/creation/renaming, explicit context, Pod and workflow backlinks, migration, saved script/configuration proposals, per-target receipts and guarded execution requests. Concurrent model turns, automatic sharing of old Pod histories, multiple selected workflows in one chat, cross-profile chats, MCP registration, new mail automation and release/installation are outside the first delivery. Ordinary administration remains available through existing UI and the separately planned owner MCP surface.

## Verified baseline and repository orientation

- Checkout: `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo.worktrees/pods-conversation`.
- Branch: `feature/issue-1358-pod-workflow-graphs`; HEAD `1d3d0310d466173ef9339d4a1644ed701b3e5ba9`.
- Canonical main fetched and independently checked with `git ls-remote origin refs/heads/main` on September 20, 2026: `934dbcec21cce8e3620ecda51a77aa8458bcfd30`. Its complete tree equals this HEAD (`git diff --quiet HEAD origin/main`, exit 0).
- [Workflow PR 76](https://repos.openape.ai/patrick/monorepo/pulls/76) is merged at that main SHA. Workflows are first-class DAGs, not a proposed serial-chain abstraction.
- Canonical source and native PRs: `https://repos.openape.ai/patrick/monorepo.git`. Issues: `https://git.openape.ai/openape-ai/openape/issues`. Create a dedicated issue and `feature/issue-<number>-central-chats` checkout from fresh canonical main after approval; this planning session creates no product branch or PR.
- Existing untracked `.claude/plans/2026-09-20-pods-local-codex-mcp.md` and `.claude/reports/2026-09-20-pods-local-codex-mcp-m1.md` belong to parallel planning and remain untouched.
- Native PR listing showed no open central Chat or MCP implementation PR; open PR 24 concerns Pods isolation feasibility and PR 10 forge comments. This is a point-in-time observation, not a guarantee that no other local work exists. Recheck before implementation.
- Stack: Electron 40, Vue 3, TypeScript, SQLite, bundled Codex runtime; Node 24.15.0 and pnpm 10.29.3 at inspection. The repository pins remain authoritative.

All following source paths are relative to `apps/openape-pods/` unless explicitly prefixed otherwise.

| Area | Current implementation and implication |
| --- | --- |
| Navigation | `src/renderer/App.vue` embeds Pod tabs and workflow navigation. Workspace chat is reached through App settings. `PodNavigation.vue` owns groups/Pods. Add Chats alongside these existing destinations. |
| Chat view | `src/renderer/MasterChat.vue` uses `podId`/`creationId`, polls at 500 ms, keeps composer buffers in `chat-buffer.ts`, and hides tool messages/drafts under Technical details. Reuse its composer, streaming and setup review. |
| Conversation identity | `src/worker/master/conversations.ts`, `MasterConversations`: scope is empty string for workspace, Pod ID for a Pod, or `creation:<id>`. `bind` moves a creation scope to one Pod. One conversation per scope; no general independent conversation ID today. |
| Storage | `src/worker/storage/database.ts`: schema 20; `master_messages`, `master_message_scopes`, `master_contexts`, `master_creations`, `pod_chat_origins`, `master_inputs`, `master_actions`, `script_drafts`, `access_proposals`. Messages return the latest 100; drafts the latest 20. Limits are view limits, not deletion policies. |
| Model context | `src/worker/master/service.ts`, `MasterService.execute/run/tool`; one active turn globally and a durable thread per scope. `transport.ts`, `MasterTransport.thread`, resumes the provider thread. Removing a visible label alone cannot remove its prior model context. |
| Workspace capabilities | `src/worker/master/control.ts`, `MasterControl.execute/apply`, and `src/contracts/master.ts` allow list/create/inspect, drafts, validate/activate/rollback, variables/groups, disabled schedule preparation, pause/resume and run. Empty workspace scope can target any Pod; selected-Pod scope is enforced in code. Workspace results aggregate drafts/proposals across Pods. No workflow tool action exists. |
| Current safeguards and gaps | Actions record request hashes/results and check Pod/draft revisions. Validation binds script, assignment and resource epoch. Instructions prohibit unrequested runs and schedule activation, but the action schema still exposes run/resume; chat intent must not rely only on those instructions. No coordinated multi-Pod apply or indexed change-set receipts exists. |
| Owner review | `src/worker/master/setup.ts`, `MasterSetup`, and `src/renderer/ChatSetupReview.vue` persist and resolve concrete proposals. `src/main/app.ts` holds native confirmations for resources, dependency downloads, exact-script credential approval and uncertain HTTP outcomes. These must not be skipped by a new adapter. |
| Activation | `src/worker/workspace/scripts.ts`, `ScriptWorkspace`, `workspace/details.ts`, `WorkspaceDetails.execute`, and `resources/script-credentials.ts` validate and activate immutable scripts with current authority checks. Reuse these domain invariants; do not duplicate activation SQL in a chat-only engine. |
| Workflow execution | `src/worker/workflows/engine.ts`, `WorkflowEngine.save/start/reserve/retry`, and `src/contracts/workflows.ts`: revision-checked DAGs, 1–32 distinct members, ALL-success joins, own schedules, immutable run definitions, whole-Pod reservations, pinned script/assignment/resource epoch. `runs/dispatcher.ts` and `runtime/terminal.ts` enforce existing execution fences. |
| External outcomes | `src/worker/recovery/`, `src/worker/mail/workflow.ts`, `workflow-transport.ts`, `docs/workflows.md`: unknown effects require reconciliation, completed DAG branches survive retry. Production autonomous mailbox moves remain blocked by the unverified conditional-move contract. Chats must preserve that block. |
| Descriptions and history | `src/worker/master/adoption.ts` requires reviewed, unambiguous legacy recovery; `descriptions.ts` summarizes a Pod scope. Multi-Pod chat text must never be blindly used as one Pod's requirements. |
| Backup and deletion | `src/worker/data/backup.ts` exports SQLite and invalidates model threads/authority on restore. `retention.ts` currently deletes Pod-scoped messages during Pod deletion: adapt this before shared chats ship. |

### Local Codex/MCP coordination

The [local MCP plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2Z32ZT7T2KYVZ76RPKFDSGG) has only a partially accepted technical milestone 1. Its isolated probe passed 19 checks; actual desktop UI acceptance, fresh-user behavior and signed integration packaging remain open. It proposes `src/main/control/` and `src/contracts/control-api.ts` for shared operations, exact owner-action bindings, revisions and receipts. These paths are proposals, not merged code at this baseline.

Align ownership before coding: one shared application-operation layer, one worker/storage writer and one receipt schema for renderer, embedded chat and future MCP. If MCP milestone 2 lands first, extend it. If Chats lands first, implement only the subset this feature needs in those agreed locations, update both plans and let MCP reuse it. Do not introduce an external MCP transport in this feature. The confined in-run `src/worker/agent/gateway.ts` exposing `ape_shell` remains separate from owner administration.

Local external Codex may administer all existing/future Pods as Patrick under the separately approved MCP scope. A chat's explicit context limits the embedded chat's operations; it is not a new global MCP Pod allowlist. Trusted caller/profile identity comes from the adapter, never model-provided arguments. Per-Pod DDISA identity, resource grants, owner IdP and required approvals remain unchanged. No protocol change is intended.

## Recommended navigation and conversation model

### Navigation

Place a prominent Chats entry near the top of the left sidebar, with New chat and a short recent list. Keep Pods/groups and Workflows as sibling destinations. The Chats page provides the complete conversation list; selecting a row opens the existing MasterChat shell. Move Workspace chat out of settings and preserve an old-navigation redirect.

Each conversation has a human-editable title, activity time and visible context summary. Inside a Pod, replace the single Chat tab with Chats: show its original conversation plus related conversations, labelled “Current context” or “Previously included.” Opening one navigates to the same central conversation ID, not a copy. Workflows expose the same related-conversation entry. New chat from a Pod preselects that Pod; from a workflow previews its members before confirmation. New Pod keeps its separate creation flow and binds the resulting Pod without losing the first request.

Keep selected Pods and workflow visible above the message stream, with direct links and removable chips. The + button beside the composer opens a compact native dialog for choosing Pods and one workflow. New chat opens the composer immediately with workspace context; Pod/workflow shortcuts may preselect a reviewed context. Avoid a permanent third inspector column; per-Pod changes appear in an expandable review card in the conversation. At compact desktop widths, the chat list becomes a back destination and context chips wrap. An available context summary remains visible when the sidebar collapses. Preserve keyboard focus, explicit labels, model selection, Enter/Shift+Enter and composer state per conversation.

### Minimal durable records

Extend `MasterConversations` instead of replacing the master runtime. Proposed additive tables:

1. `conversations`: stable ID, title, timestamps, current context revision and optional origin Pod/creation link. Conversation identity never changes when context changes.
2. `conversation_contexts`: immutable `(conversation_id, revision)` records with explicit Pod IDs, optional workflow ID/revision, pinned members/edges, source provenance for each Pod, and creation time. Membership association/index supports current and historical Pod/workflow backlinks; it must not cascade-delete the conversation when a Pod disappears.
3. `conversation_segments`: ID, conversation/context revision, provider thread ID/state. New context means a new segment. Add message links to conversation and segment; preserve existing message IDs/bodies/order.
4. Focused change-set records and target entries referencing existing drafts/proposals plus shared operation receipts. Reuse the existing idempotency/action store where possible; normalize conversation/Pod/workflow correlation rather than storing a second copy of every tool transcript.

The single active `master_session` remains the turn coordinator in v1. Show “Another chat is running” with Open chat; no hidden queue or automatic cancellation. Navigation does not cancel a turn. Multiple conversations are supported; simultaneous embedded-model turns are not part of this change. External MCP writes still require optimistic concurrency.

### Workspace and explicit context contract

| Context | Model may read | Model may prepare or request |
| --- | --- | --- |
| Workspace only | App/runtime guidance, connection readiness without secrets, Pod/workflow catalogue IDs/names/lifecycle and member IDs/names needed for selection | Create a paused Pod from an explicit user creation request; propose adding context; explain setup. No arbitrary existing Pod inspection, script edit, execution, account change or resource grant. |
| Explicit Pod(s) | Current selected Pods' settings, saved scripts, ordinary variables, redacted resource readiness, bounded run/checkpoint evidence; bodies loaded on demand | Scoped drafts/settings proposals, validation after readiness, access requests, reviewed apply and explicit run requests through shared operations. |
| Workflow + pinned members | Selected workflow definition/revision/edges/schedule state and explicit member Pod evidence as above | Workflow definition/schedule proposals plus member drafts. Execution remains the existing DAG engine. Selection alone changes no Pod or workflow. |

The backend validates every target against the immutable active context revision, including read/inspect, setup continuation, proposal resolution, cancellation and tool results. A model request naming another Pod returns `context_required` with a visible selection proposal; it never silently expands scope. Owner selection through + and Confirm context creates the new context revision. Closing the dialog or confirming an unchanged selection does not change context. Input describing another Pod is not by itself a selection receipt. All list projections are bounded and distinguish catalogue metadata from selected content.

Adding a Pod imports its current saved state on demand, not its other chats. Direct transcript import is outside v1. Data from Pods, mail, files, tool output and assistant text stays labelled untrusted input; it cannot change context, authorize a run, satisfy review or supply a trusted confirmation. Secrets never enter messages, ordinary variables, summaries, receipts or mockup data.

### Adding/removing context and model continuation

Context editing is disabled during an active turn. Patrick can stop that turn, wait for tool settlement and then edit; stopping a model turn does not undo persisted work or stop accepted Pod runs. Commit a context change only after the active turn is settled.

Every confirmed change appends a visible timeline event and starts a fresh provider thread/segment. The complete prior transcript remains readable locally, separated by the event. Do not resume the previous provider thread, replay the earlier transcript or automatically summarize it into the new segment. It may contain intertwined removed-Pod information that cannot be reliably filtered. The composer explains that the next message starts from the selected saved state; Patrick may intentionally restate the task. This is a model-context boundary, not deletion of previously sent provider data or local history.

Pending changes from older context revisions remain inspectable but cannot be applied automatically. Rebase/review them under the new context; out-of-scope items stay suspended. Adding back the same Pod does not resurrect its old provider thread. A read failure or archived/deleted Pod stays visibly unavailable and blocks writes; it never resolves to another Pod by name.

### Workflow membership contract

Workflow selection is a snapshot of its current revision, DAG and member IDs. Display those member Pods explicitly, including why each is included. Permit one workflow plus individually added Pods in v1. Deduplicate a Pod selected both directly and through the workflow while retaining both source references.

Later workflow edits do not silently add/remove chat context. Show “Workflow changed” with added/removed members and graph/schedule differences. Workflow writes/runs require refresh and a reviewed new context revision. Until refreshed, independently selected valid Pods may still be inspected or edited; no stale workflow operation is permitted.

Removing the workflow removes its member-derived context but keeps directly selected Pods; preview the effective removal list. Removing one member while keeping an intact workflow selection is ambiguous: offer “Detach workflow and keep these selected Pods,” then let Patrick select the remaining set. Do not pretend a partial member set still authorizes running the full workflow. Workflow membership itself never rewrites Pod scripts, groups, identities, lifecycle or independent schedules.

## Change and execution contract

### Prepare → review → apply

Use a focused change set for a coordinated request. Each target records Pod/workflow ID, current context revision, base Pod/settings revision, active-script hash, draft ID/revision/hash, binding revision, resource epoch and any relevant variable/schedule/group/workflow revisions. Pin dependency manifests and validated package hashes where applicable. Do not use a single timestamp as a concurrency token.

Preparation saves each useful script draft and setup proposal immediately. Partial preparation is legitimate and shown per Pod: Draft saved, Needs input, Needs owner approval, Validation failed, Ready for review. No active script is changed during this stage. Saved draft/proposal IDs and validation receipts, rather than assistant prose, drive those labels.

The review card shows the complete affected set, per-Pod before/after diff, intended behavior, synthetic validation evidence and permission/credential/dependency requests. Distinguish “Use this version” from “Run once.” Selecting Review does not grant access. Existing concrete owner forms/dialogs grant resources, prepare dependencies or approve an exact credential-reading hash; a general Apply click does not replace them. Shared operation responses return a resumable owner-action reference. The model cannot forge an approval boolean or replay a decision for another hash/epoch.

After all required inputs and reviews, Apply changes commits the requested local configuration together. Reuse/factor existing domain validation and perform final revision/hash/epoch/approval/lease checks and local state updates in one SQLite transaction, with all target receipts written in that transaction. No network calls, dependency downloads or model calls belong inside it. Drafts/blobs/validation are prepared beforehand; only local active references and approved configuration are committed. If any target is stale, busy, unapproved or invalid, apply none and report target-specific reasons. A duplicate operation ID returns the original committed receipt; changed arguments with the same ID fail.

This atomic boundary covers local configuration in this one database, not separate permission approvals, already saved drafts, external services or actual runs. Preapproved resources remain if a later apply fails; report them as completed setup actions. Avoid automatic compensation that revokes useful access or attempts to reverse external effects.

Reject apply while a target has a run lease, terminal/program lease, workflow reservation or unresolved effect/input fence. Recheck inside the transaction so scheduled/other starts cannot race the commit. Pending run snapshots referencing old hashes then block through the existing workflow engine; never rewrite their evidence. Draft preparation can continue while runs exist. App schedules are not paused implicitly by viewing or selecting chat context.

Chat changes to a currently enabled schedule require a separate explicit review explaining deactivation; never disable one incidentally to prepare its replacement. New schedule proposals remain disabled. Existing workflow edits preserve `enabled`, `paused` and next-slot semantics unless an explicit owner operation changes them. Embedded chat never obtains schedule-enable authority through `resume`, generic workflow save, activation or apply. Schedule activation remains the existing owner settings action, outside the initial Chats change-set scope.

### Receipts, failures and recovery

Use shared operation results with `operationId`, trusted caller kind, conversation/segment/turn where applicable, context revision, change-set/target, state, base and resulting revisions/hashes, draft/proposal/run references, timestamps and structured error. Include the full stable identifiers in details while showing names and plain-language outcomes in the UI. Index receipts per Pod so its History can open the originating chat and diff. Old receipts show “Applied then; later changed” when current state differs.

Model tool-call IDs deduplicate retries within a turn today. Add a durable change-set/apply operation ID independent of a new model turn, and bind it to an argument digest plus relevant profile identity. Store successful local mutation and receipt atomically. On timeout, reconnect or crash, inspect the receipt/state before retry; never infer “not applied” from a lost response. Interruption during preparation preserves successful drafts, marks unfinished validation as interrupted and offers targeted continuation. An apply interrupted before commit has no applied targets; a committed apply has its original receipt even if the UI response was lost.

Between review and apply, changes by another chat, Pod editor, MCP client, permission refresh or workflow edit return a conflict with changed fields. Refresh, regenerate the diff and revalidate only the affected targets; require a new review of the resulting set. Do not overwrite automatically, rebase scripts invisibly or reuse an old approval. Retain completed setup/validation receipts as historical evidence.

### Execution remains separate

Embedded-model `run` and workflow run requests produce a concrete action showing exact target(s), validated script hashes, DAG revision and side effects. A trusted user Run once action creates an execution intent bound to that snapshot; the model cannot authorize itself from quoted mail or assistant text. Existing direct owner UI or authorized external MCP run operations keep their current semantics without a new generic approval prompt. Run status comes from dispatcher/workflow run IDs, never from text saying “accepted.”

Starting means queued/accepted, not completed. Reuse the Pod's executor, grants, credential approval, concurrency limits and reservations. Workflow runs show completed, waiting, failed/blocked nodes; independent branches may finish after another fails. Retry only the eligible failed node after current-state/recovery checks; never rerun successful nodes. Unknown external effects remain Needs reconciliation, with the existing owner-evidence workflow. “Stop response,” “Cancel run” and “Pause schedule” are separate actions. No implicit retry of uncertain mail/HTTP/Telegram effects. The production conditional-move block and the paused Troop/OpenClaw automation are unaffected.

## Migration and retention

Choose the next schema version after rebasing on main; 21 is only the next version at this inspected baseline. Use an additive, transactional and idempotent migration with a pre-migration paired backup. Never open the real owner profile for development verification.

1. Create exactly one conversation for each distinct legacy scope across messages, contexts and creations, including empty scopes with a retained thread. Empty string becomes the named Workspace chat; Pod scope becomes its original conversation; an unbound creation scope remains its own creation conversation. Retain bound-creation aliases and `pod_chat_origins` without duplicating messages.
2. Preserve every message ID, raw body, role, timestamp, state and stable order, all action/input hashes and receipts, drafts, approvals and creation links. Do not merge two Pod conversations or infer scope from names or assistant claims. Ambiguous workspace history stays in Workspace chat with the existing explicit reviewed adoption flow adapted to conversation IDs.
3. Existing Pod and creation contexts may retain their provider continuation ID when their effective context is unchanged and they were not running. Migrated broad Workspace chat receives a new empty workspace-only segment before its next turn, because its historical provider context could contain arbitrary Pods. Retain its old thread reference for audit, never resume it under the new narrow contract. Interrupted turns remain interrupted; migration starts no work.
4. Add conversation-ID commands and update all embedded callers together. Retain a narrowly bounded legacy scope resolver for creation/adoption and restored older backups; fail on ambiguous inputs rather than silently choosing one conversation. Do not maintain permanent dual writers.
5. Make history paginated with a stable ordering/cursor, preserving the initial-request link without duplicating it. “Load earlier” must reach more than the current 100 messages. Keep raw legacy action results without fabricating missing before-state or validation proof. Clearly label them as legacy receipts where correlation is incomplete.
6. Backup includes new context/segment/change-set/receipt records. Restore keeps the existing authority invalidation, disables schedules, clears all provider continuation IDs and blocks old apply/execution intents until revalidated. Preserve restored transcript and interrupted statuses. Never replay pending writes on startup.
7. Pod archival leaves related chats readable with an archived badge. Pod deletion must not cascade-delete shared conversations or remove another Pod's evidence. Replace references with tombstones and retain historical names/IDs. Explicit chat deletion/history retention is separate and must explain shared affected data using the existing deletion confirmation policy; no automatic chat deletion in v1. Adapt `retention.ts` and backup validators together.
8. Pod descriptions continue to derive from that Pod's original conversation and accepted Pod-specific changes. Do not summarize a full shared transcript into every member Pod. Until a target-specific source projection is proven, shared chats do not automatically update Pod descriptions.

Migration verification compares row counts and exact message body hashes/order, creation origins, draft/approval/action records, conversation links and schedule states before/after and after reopening. Cover legacy schemas through the existing migration fixture and current schema 20 with mixed scopes, >100 messages, interrupted turns, archived Pods and an unbound creation. A migrated database is not opened by an older binary; rollback uses the paired old app/profile, preserving the newer snapshot separately.

## Review mockup

The standalone synthetic mockup lives at `.claude/mockups/pods-chats/index.html`. It uses existing Pods colors/type and shows Chats in the sidebar, related Pod conversations, a workflow plus explicit member chips, reviewable per-Pod drafts, context editing, workflow drift, a conflicting apply and a recorded apply. Its local interactions never call the application or services. Names, revisions and results are illustrative fixtures, not observations of Patrick's installed Pods.

<div class="grid"><div class="card"><span class="badge badge-info">Navigation</span><h3>Chats</h3><p>Mail filter &amp; short report<br>Workspace chat<br>Original Pod conversations</p></div><div class="card"><span class="badge badge-info">Explicit context</span><h3>Morning mail · revision 7</h3><p>Mail filter · Short report<br>Change context · Review workflow changes</p></div><div class="card"><span class="badge badge-warn">Review changes</span><h3>2 saved drafts</h3><p>Per-Pod diff and validation<br>Apply together · Run separately</p></div></div>

The mockup was visibly opened in the in-app browser and personally inspected at 1060, 760 and 560 px, including dark mode. [Inspected design evidence](https://testrun.openape.ai/r/tf3hZwfwNLKey7Aih7XJnicO). The report explicitly leaves product acceptance skipped. The interactive mockup is available locally at `http://127.0.0.1:8769/` while this session server is running and as the standalone file named above. Mockup interaction checks establish the design artifact's behavior only; they are not product acceptance tests.

<img src="https://testrun.openape.ai/api/public/runs/tf3hZwfwNLKey7Aih7XJnicO/assets/desktop.png?v=1" alt="Synthetic central Chats design with explicit workflow members and per-Pod review cards" />

## Milestones

### Milestone 1 — Shared operation contract and migration

**Goal:** Stable conversation identities and one reusable operation/receipt boundary without changing existing execution authority.

Recheck main and the MCP plan/PR, agree the shared file ownership, then implement the additive schema/migration in `storage/database.ts`, context/segment logic in `master/conversations.ts`, contract parsing in `contracts/master.ts` plus the shared control contract, and backup/retention changes. Keep existing UI access working through the resolver until milestone 2. Include receiver-side scope and revision enforcement and exact owner-action handling in the shared layer; no transport registration.

**Acceptance:** Legacy fixtures reopen with byte-identical messages, separate threads where safe, unchanged schedules, and working creation/adoption links; restored chats require fresh model context; shared history survives Pod deletion. Out-of-context reads/writes and forged owner decisions fail. Existing scoped conversation tests stay green.

**Rollback:** Revert adapter changes through a native PR; for a migrated test/profile use paired backup and old app. Never down-migrate a live newer database in place.

### Milestone 2 — Chats navigation and deliberate context

**Goal:** Patrick can start/find multiple conversations and see/change their exact scope.

Extend `App.vue`, reuse `MasterChat.vue`, and add focused conversation list/context picker components under `src/renderer/`. Change buffers and commands to conversation IDs. Add Pod/workflow backlinks and historical context markers. Implement context snapshots, provenance, drift UI, fresh segment transitions and backend rejection of stale context calls. Use a single active embedded-model turn with an explicit busy destination. Adapt Pod summaries conservatively.

**Acceptance:** Two chats for one Pod have independent drafts/composers/transcripts; existing original chat stays reachable; a shared chat opens unchanged from either Pod. Add/remove starts a new provider thread and sends no previous transcript; history is still readable. Workflow edits show a diff before refreshing context. Empty context cannot inspect a Pod's script. Narrow-layout chips and all actions remain readable and keyboard reachable.

**Rollback:** Hide the new navigation temporarily while retaining data and the legacy resolver; do not delete conversations or silently flatten their contexts.

### Milestone 3 — Coordinated changes and evidence

**Goal:** Multi-Pod editing yields saved drafts, concrete review and reliable per-Pod apply results.

Factor a small change-set coordinator around existing draft, validation, activation, settings and workflow operations. Add target correlation to receipts, partial-preparation display, exact diffs, current-approval status and atomic local apply. Share these operations with the proposed main/control layer. Extend Pod History to link to change receipts/conversations. Keep schedule activation and external effects outside apply.

**Acceptance:** The mail-filter/report fixture saves two drafts; failed validation on one keeps both active versions unchanged. Once both are valid/reviewed, one Apply updates both with immutable receipts. A stale hash/revision, removed permission, held lease or workflow reservation updates neither. Repeated apply returns the same receipt after a simulated lost response. Owner resource/credential actions retain exact existing decisions. Old-context drafts cannot apply until explicitly rebased/reviewed.

**Rollback:** Disable new apply entry points, retain all saved drafts and receipts, and use existing reviewed script-version selection for any deliberate restoration. No automatic permission revocation or external compensation.

### Milestone 4 — Execution, native acceptance and handoff

**Goal:** One-shot runs and recovery display actual outcomes and honor all existing fences.

Add explicit run intents for embedded chat, delegate to dispatcher/workflow engine and show stable run links. Extend existing synthetic component, native E2E and layout tests; refresh the established handbook source/screenshots after behavior stabilizes. Recheck MCP parity for the shared subset if that adapter is available; otherwise document its unimplemented integration honestly. Record exact source/target SHAs and native PR evidence in `docs/agents/active-work.md` in the implementation checkout.

**Acceptance:** An assistant claim without a tool receipt never displays Saved/Applied/Completed. A workflow with a parallel branch failure keeps successful nodes, blocks descendants and retries only the reviewed node. Missing grants and uncertain effects block. Stop response does not pretend to stop a run. All required CI suites pass on final source; screenshots cover desktop/compact/dark mode and the actual packaged renderer. No real mailbox, Telegram, owner account, installed app or active schedule participates in automated acceptance.

**Rollback:** Remove the chat run-intent adapter while retaining execution history and the ordinary Pod/workflow controls. Installation, signing and production pilot are separate authorized work.

## Test strategy and commands

Use existing suites; no new runner, package scripts or default test-chain changes. New test files are allowed inside the existing suites only when the contract does not fit an existing file. Keep permanent tests for context isolation, data migration, exact approval, concurrent changes, idempotency and execution refusal because failures risk lost data or unintended effects.

| Contract | Established test route |
| --- | --- |
| Migration, scope, creation, adoption, history pagination | `test/storage/database.test.ts`, `test/storage/legacy.ts`, `test/workspace/conversations.test.ts`, `adoption.test.ts`, `test/data/backup.test.ts` |
| Parser, saved drafts, setup and revisions | `test/master/setup.test.ts`, `test/workspace/scripts.test.ts`, `script-authority.test.ts`, `test/credentials/authority.test.ts` |
| Visible navigation, context picker, review/error states | `test/master/ui.test.ts`, `setup-ui.test.ts`, `test/workspace/ui.test.ts`, `test/scheduling/workflow-ui.test.ts` with Vue Test Utils/happy-dom; assert visible text/actions, not private implementation |
| Real model transport, saved state, IPC approvals | `e2e/master.test.ts`, `master-ui.test.ts`, `chat-setup.test.ts`, `prompt-setup.test.ts` using the packaged fixture app, isolated profile and recorded provider; verify provider input and thread identity for context changes |
| Reservations, partial execution, recovery | `test/scheduling/workflows.test.ts`, `test/recovery/effects.test.ts`, `e2e/workflows.test.ts`, `crash-recovery.test.ts`, `recovery.test.ts` |
| Geometry and appearance | Extend `e2e/master-ui.test.ts`/`workflows.test.ts`/`pod-workspace.test.ts`; actual packaged Electron CSS at 1060, 760 and 560 px, light/dark, long titles, many context chips, opened review/context panels. Measure overlap/overflow and inspect screenshots. Happy-dom is not layout evidence. |

Negative acceptance must send forged out-of-context IDs, stale context/segment IDs, old approval hashes, model attempts to run/enable schedules, duplicate apply IDs with changed arguments and concurrent MCP/editor updates. Feed adversarial Pod/email/tool text asking to expand context or approve itself; verify the receiver refuses regardless of model wording. Include the one-active-turn behavior and context edit while tools are settling. Test restore/reopen at preparation and apply crash boundaries. A synthetic model proves transport/enforcement, not live generation quality.

From the implementation checkout, start each tool shell with `. ./scripts/activate-node.sh`. Run `pnpm run doctor`. Follow the repository's serial shared dependency prebuild from `pnpm check:affected --base origin/main --head HEAD --dry-run`; do not race declaration builds. Required verification order: `pnpm lint`, `pnpm typecheck`, `pnpm --filter @openape/pods build`, `pnpm --filter @openape/pods test`, `pnpm --filter @openape/pods package:mac`, `pnpm --filter @openape/pods test:e2e`, `pnpm docs:check`, `pnpm check:affected --base origin/main --head HEAD`, then complete `pnpm check:ci`. Stop and fix the first failure. `test:layout` is the existing build/package/native E2E route; do not substitute a separate web story runner. No missing/skipped required suite counts as green.

For focused development use existing Vitest file arguments after `pnpm --filter @openape/pods test`; native tests use the existing `vitest.electron.config.ts` and recorded provider/fixture launch. Never launch `pnpm dev` against the owner profile for acceptance. Full acceptance retains actual commands, complete logs, exact tested SHA and screenshots. Native final-source CI must match the reviewed PR source and target; use the native expected-SHA merge gate.

## Progress

- September 20, 2026: Read repository/global rules, resolved the worktree through the main-checkout vault symlink and read `private-openape-openape-monorepo/MEMORY.md` plus `pods-chat-setup-contracts.md` and relevant workflow/visual/plan references.
- September 20, 2026: Fetched canonical main, read native PR 76 and open PR metadata; full local tree equals the merge tree. Inspected navigation, transport, storage, setup, script activation, workflow engine, backup and deletion paths, existing tests and parallel local MCP plan/evidence.
- September 20, 2026: `pnpm run doctor` passed (`ok: true`), with the expected warning for the two pre-existing untracked planning files.
- September 20, 2026: Baseline command `pnpm --filter @openape/pods test test/workspace/conversations.test.ts test/workspace/adoption.test.ts test/master/setup.test.ts test/workspace/script-authority.test.ts test/scheduling/workflows.test.ts` passed: 5 files, 28 tests. This verifies existing contracts, not the proposed feature. Full product CI is not claimed for a planning-only session.
- September 20, 2026: Opened the interactive mockup visibly and inspected screenshots at 1060/760/560 px in light/dark modes. Content width matched viewport at all three sizes. Exercised Pod backlinks, context removal, partial preparation, concurrent-change refusal, workflow drift refusal and synthetic apply receipt. Corrected mockup scenario reset and stale-workflow apply handling; inspected the final views. Evidence: https://testrun.openape.ai/r/tf3hZwfwNLKey7Aih7XJnicO. Standalone screenshot report: `.claude/mockups/pods-chats/inspection.html`. Mockup SHA-256: `af5a19e8a4dba5c523b4c7fb5fd0c34531b11faec16c3421ae83059ab1713e45`.
- September 20, 2026: Published this plan as draft in the OpenApe team; verified the public evidence page and opened the actual plan renderer. Rechecked canonical main before handoff: still `934dbcec21cce8e3620ecda51a77aa8458bcfd30`.
- September 20, 2026: Patrick approved implementation. Issue: https://git.openape.ai/openape-ai/openape/issues/1359. Dedicated implementation checkout: `../pods-central-chats`, branch `feature/issue-1359-central-chats`, based on canonical main `934dbcec`. No newer main commit or open MCP implementation PR was present.
- September 20, 2026: Implemented additive conversation/context/message associations on schema 21; existing scope storage remains the compatibility resolver. Scoped unit/component suite passed 327 tests before the latest execution-receipt additions. Native focused suite passed 16 tests across Chats, original master chat, scoped tools and prompt setup. Final-source full gates are still pending.
- September 20, 2026: Patrick requested the simpler ChatGPT-style + entry point. New chat now opens immediately; + opens a compact context dialog and chips expose removal. Inspected actual packaged screenshots at 1060/760/560 px and opened the context screenshot in Codex. Context enforcement and owner decisions remain unchanged.
- September 20, 2026: 333 unit/component tests and 16 focused native regression tests passed. Full lint (51 tasks), full typecheck (72 tasks), build and fixture package passed. The full native pass exposed outdated navigation expectations and a real narrow-sidebar group-confirmation overlap; both were fixed and verified. Final-source full CI and native PR review remain pending.
- September 20, 2026: Re-read the parallel MCP plan: milestone 2 remains pending; no competing implementation PR exists. The shared coordinator lives beside the existing worker writer in `worker/control/changes.ts`; `contracts/control-api.ts` is the shared receipt boundary. Future MCP reuses authenticated main-process owner surfaces and this coordinator. Saved Pod drafts retain independent IDs and are shared saved artifacts available to selected chats; transcripts, composers and pending reviews remain conversation-specific.
- September 20, 2026: Checkpoint `b923685d166a1781e0d09a3d44826c436fb7101a` passed all repository gates before the native Pods step, where 133/135 tests passed; two startup polls expired at `starting` before functional assertions. Increased only those bounded readiness waits to 10 seconds and retained all behavior assertions. Added per-Pod conflict diagnostics during review. Complete gate rerun required; the protected push was correctly blocked.
- September 20, 2026: Follow-up passed 334 unit/component tests, full lint/typecheck, app build/package and all 4 focused native checks for dependency preparation, terminal feedback and Chats. Final full contract rerun and native PR review remain required.
- Milestones 1–4: implemented; complete repository verification and native PR review in progress.

## Surprises & Discoveries

- Workspace chat already has cross-Pod control, but scope is also conversation identity and the API has no workflow actions. A navigation-only change cannot supply the requested context contract.
- Provider threads retain prior context independently of the visible history. Scope removal requires a fresh provider thread, not merely removing a chip.
- Pod deletion currently deletes messages by Pod scope. Shared conversation retention must be explicitly adapted during migration.
- Native main-process dialogs contain important authority decisions; sharing only worker dispatch would bypass their review. The MCP plan independently identified this same boundary.

## Decision Log

| Date | Decision | Reason / alternative considered |
| --- | --- | --- |
| 2026-09-20 | Independent conversation ID and explicit context revisions | One chat per Pod and an unrestricted workspace thread cannot express deliberate multi-Pod work. |
| 2026-09-20 | Fresh segment on any context change, no automatic transcript summary | Reliable removal cannot be guaranteed by model-generated filtering of mixed conversation text. History remains visible. |
| 2026-09-20 | Pin workflow membership and review drift | Following live membership would silently expand model access and mutation targets. |
| 2026-09-20 | One active embedded turn in v1 | Reuses the existing coordinator; simultaneous sessions require separate runtime/locking work with little benefit to this first delivery. |
| 2026-09-20 | Atomic local apply, separately journaled setup/execution | A single SQLite writer can prevent partially activated cooperating scripts; external effects cannot share that transaction. |
| 2026-09-20 | Reuse master_contexts for the current provider segment and chat_contexts for retired threads | Preserves the existing scope resolver and avoids a second session coordinator. Message links record exact context revisions. |
| 2026-09-20 | Composer + and removable chips | Patrick requested this simpler entry point during implementation; context selection stays explicit. |
| 2026-09-20 | Shared UI/chat/MCP operations, existing authority | Avoid competing management semantics and preserve exact owner decisions and Pod execution identities. |

## Session checklist

1. Read this plan and the recorded approval; use a fresh implementation session after approval.
2. Read current rules/vault, inspect status, fetch canonical main, review new commits and coordinate any MCP operation-layer work.
3. Create/resolve the dedicated issue and isolated feature checkout without switching or cleaning other worktrees.
4. Activate pinned tooling, run doctor and baseline checks; select one incomplete milestone.
5. Implement only approved scope, update plan/progress and active-work evidence, verify using existing suites.
6. Publish the native PR with full issue URL, exact source/target and test evidence; preserve data and authority through rollback.

## Outcomes & Retrospective

Planning deliverables are the baseline assessment, recommended contracts, synthetic mockup and reviewable plan. Product implementation is in progress after recorded approval. Installation and live acceptance remain excluded. Final implementation outcomes and retrospective remain pending.
