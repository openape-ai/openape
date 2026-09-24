# Pods: connected Codex administers the app

Status: approved by Patrick on September 24, 2026 ("ja freigegeben"). Issue: https://repos.openape.ai/patrick/monorepo/issues/1377.

Reviewable HTML plan: https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3971H91PDY5XPHJP3696PZ7.

## Purpose and scope

Once connected, local Codex administers Pods without another approval round inside Pods. Codex applies its own tool and permission policy. Pods remains the place to inspect automations, resources, schedules and run history. Conversations happen in Codex.

Patrick explicitly superseded the issue-1375 requirement that activation, permissions and runs require owner clicks inside Pods. His screenshot shows both the unwanted approval cards and the embedded chat. Patrick approved complete removal of the embedded conversation UI.

Deliver direct administration of Pod definitions, variables, validated scripts, activation, rollback, schedules, runs, recovery, workflows and resource assignments. Add an opaque local secret import so a value received through OpenApe Secrets can enter the encrypted store without appearing in MCP arguments, responses or audit logs. Keep existing Pod runtime permissions and authentic external grants: authorizing Codex to configure a Pod does not invent an external provider credential or consent.

Do not change the owner's Codex permission settings, expose secret values or run contents to Codex, expand unrelated background agents, or automatically execute old pending proposals. Preserve all existing Pods and stored conversation history. The IURIO monitor must eventually observe all open IURIO/iurioServer PRs every 15 minutes and notify the confirmed Telegram destination only on meaningful changes.

## Repository and setup

Canonical repository: https://repos.openape.ai/patrick/monorepo.git. CI mirror: https://git.openape.ai/openape-ai/openape. Base: 29f77d2943e6a75248655b4216b79bc42d4344e7. Working directory: /Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo.worktrees/issue-1375-completion-docs. Branch: feature/issue-1377-codex-owner-control. The main checkout is bare; do not change its configuration.

Electron, Vue and TypeScript; SQLite mutations remain behind the existing worker/domain writer. For every shell use the explicit working directory and run `. ./scripts/activate-node.sh` before pnpm. Reuse existing installed dependencies; if installation is necessary use `pnpm install --frozen-lockfile`.

Relevant files and entry points:

- `apps/openape-pods/src/contracts/codex.ts`, `src/runtime/codex-mcp.ts`: tool schema, descriptions and MCP instructions.
- `src/main/codex/server.ts`, `registration.ts`: local socket transport and connection lifecycle; retain the private socket and stopped-app error behavior.
- `src/worker/codex/control.ts`: `CodexControl.execute`, direct action selection and metadata-only results.
- `src/worker/master/control.ts`, `src/worker/control/changes.ts`: `MasterControl.execute`, existing domain operations, revisions and idempotency. Reuse these rather than introducing another database writer.
- `src/main/app.ts`, `src/main/programs/`, `src/worker/resources/script-credentials.ts`: existing encrypted credential, HTTP, directory, program and script permission services. Extract shared administration operations where renderer handlers currently embed app-only confirmation dialogs.
- `src/renderer/App.vue`, `CodexPanel.vue`, `CodexReviews.vue`, chat and resource components: navigation, connection explanation and direct management forms.
- `apps/openape-pods/docs/chats.md`, `docs/handbook*.json`, `docs/agents/active-work.md`: final behavior and operational handoff.

Paths beginning with `src/` above are relative to `apps/openape-pods/`.

## Decisions and authority

1. A connected local Codex is an owner administration client. There is no second Pods approval queue for its requests. Describe this authority explicitly in the existing connection settings.
2. The MCP request contains no authenticated Codex sandbox/approval mode. Do not infer per-task permission from global configuration or add an untrusted `fullAccess` boolean. Codex enforces its own policy before calling tools.
3. Revision checks, resource epochs, script validation, credential binding and effect recovery remain integrity requirements. They return actionable errors to Codex instead of asking the user to click an approval card.
4. Provider sign-in and external authorization remain real provider operations. Missing credentials are reported as missing inputs, not resolved by manufacturing grants or copying owner login caches.
5. Stored drafts and history survive the UI transition. Pending proposals are not automatically applied. Reconcile already-satisfied proposals and explicitly retire superseded ones through domain operations with an audit receipt.

## Milestone 1: direct local administration

Route connected Codex commands through shared administration services. Apply validated script activation, rollback, variables, workflow saves, enabled schedules, runs and recovery directly. Retain selected Pod/workflow scope, immutable revision checks, idempotent action receipts and one writer. Extend the schema only where the existing commands cannot express the operation. Return applied state and actual run IDs; never describe a prepared draft as live.

Acceptance: existing `test/codex/control.test.ts`, `test/main/codex-server.test.ts` and related worker tests prove direct effects, stale input refusal, duplicate-call behavior, stopped/disconnected access and unchanged metadata-only inspection. No new review entry appears after a successful Codex command. Existing workflow and effect recovery behavior still passes.

Rollback: revert this milestone before release; no production profile migration or live action is needed for its tests.

## Milestone 2: resources and private secret import

Expose resource inspection and assignments through the same services used by the owner UI. Apply HTTP and directory permissions and script credential bindings directly with their required revisions/epochs. Use actual program/grant authorities for program access. Introduce opaque secret import from an owner-controlled private local file; the tool receives the path/reference and metadata, never the value. Validate file ownership, type, size and permissions; reject symlinks and avoid time-of-check/time-of-use races. Do not put credential plaintext in persisted action records, exception text or logs. Define retry behavior so uncertain responses neither duplicate credentials nor silently replace a different version.

Acceptance: existing credential/resource/main harness suites cover successful import, denied invalid paths, redacted failures, stale binding refusal and retries. The same credential can be used by an authorized script without being returned to Codex. External grant denial remains an honest error. No broad permission is added to an unrelated Pod.

Rollback: revert the new commands; imported values use the established encrypted credential format and remain manageable in the owner UI.

## Milestone 3: Pods management UI without embedded chat

Remove Chat navigation, Pod chat tabs, composers, chat-based onboarding and the Prepared by Codex approval destination. Keep Overview, Script, Variables and secrets, Permissions, Settings and History. Make Pod creation and description editing ordinary forms. Link the existing Work from Codex connection settings where conversation entry points used to be. Keep internal context records as needed by existing services; remove UI dependencies only after replacing their management functions. Historical chat records are retained but not offered as an active conversation surface.

Acceptance: existing component/browser tests prove that new Pod creation, editing and connection settings remain accessible with no Chat tab or pending Codex approval cards. Review actual screenshots at desktop and narrow widths. Extend existing packaged acceptance to initialize the installed MCP shim outside the checkout, change a fixture Pod, enable a fixture schedule and run a deterministic fixture without app review clicks. Do not use the real profile for automated tests.

Rollback: restore UI code; no chat-history deletion or destructive database migration is required.

## Milestone 4: merge, signed installation and IURIO acceptance

Update architecture, handbook and active-work record to the final contract. Run full `pnpm lint`, then `pnpm typecheck`, then `pnpm --filter @openape/pods build`, then `pnpm --filter @openape/pods test:fast`; stop at the first failure. Use focused existing tests during development and retain tests for the authority, secret handling and upgrade contracts. No new test runner or default test-chain changes.

Before every push or xcodebuild inspect https://git.openape.ai/api/v1/repos/openape-ai/openape/actions/tasks. Do not disrupt the shared Mac runner. Open an issue-linked native PR, inspect its diff and wait for external CI, E2E and layout checks for the exact head before merging. Before distribution run the repository-required `pnpm check:ci`; document this deployment check separately from the merge gate. Build and verify a signed/notarized candidate using the existing distribution scripts and isolated profile. Preserve the app/profile rollback pair before an authorized owner installation.

After installation verify the connected Codex executes administration without Pods clicks. Preserve the existing running Pods and reuse group `iurio` and Pod `IURIO PR monitor`; do not create duplicates. Its schedule currently exists at 900 seconds but is disabled, its script is a draft, and the Telegram credential is stored. The Azure read credential and HTTP bindings were still absent at the last inspection. Reinspect metadata, import only credentials actually supplied through OpenApe Secrets, assign the required endpoints, validate and activate the script, apply the confirmed Telegram destination and enable its schedule. The monitor reads PRs/comments/reviews/policies and must preserve its baseline on partial reads or uncertain delivery. Verify a real run and an authorized Telegram delivery before calling the monitor complete. Request a missing Azure credential through OpenApe Secrets if still necessary; do not substitute the owner's CLI login store.

Rollback: stop only the specific app/monitor being updated, restore the saved app/profile pair together and record the outcome. Never terminate processes by name patterns. A code revert does not undo a message already sent; record delivery state and avoid resending uncertain effects.

## Progress

- September 24: inspected installed behavior, source and the previous plan; created issue 1377 and a clean branch from canonical main. No product code, real profile or Codex settings changed for this issue.
- Milestones 1–3 implemented. Local full lint/typecheck and app build pass; 436 unit/component tests, 20 browser checks and two focused packaged MCP acceptance tests pass. Milestone 4: PR 113 merged as `56eb0366` after all three exact-source external checks passed for `29447001`. Full deployment check `1790239240109-29447001-all` passed, including all 109 packaged Pods cases. The signed/notarized internal build passed mounted-DMG acceptance and is installed; all six existing Pods were preserved. Live IURIO acceptance still awaits the dedicated Azure credential.

- September 24 follow-up requested by Patrick: remove the remaining per-script secret selector and declaration checks, document executable/adapter/grant/login setup through MCP runtime help, and assign Azure CLI to the existing IURIO Pod. The owner profile is not used as the Pod login store. Azure DevOps extension/runtime support must be verified before CLI-based scheduled monitoring.

## Discoveries

- The old issue-1375 plan already said that Pods shows no chat, but the current renderer still exposes workspace and Pod chats. Patrick's September 24 screenshot confirms the mismatch.
- Schema 23 adds a manual-description flag so pending legacy summarization cannot overwrite direct edits. Migration fixtures explicitly reconstruct their older schema before upgrade.
- The current MCP action envelope is only an ID and action. Neither the shim nor the local socket proves a Codex full-access mode.
- Removing visible review cards alone cannot enable schedules, bind resources or import secrets through the supported API.

## Outcomes

Implemented locally and verified through a real isolated Codex app-server: private fixture secret import, script validation/activation, enabled schedule and a completed deterministic run without app approval clicks. Merged through [PR 113](https://repos.openape.ai/patrick/monorepo/pulls/113), source `294470018230ef03fc0bf0c75046c7bffb19e9d3`, merge `56eb0366cf83638dc63615fa8c407534b2e0ea9b` (identical trees). [Inspected UI evidence](https://testrun.openape.ai/r/z7Gh5qVdFwQdXTRnaQnVUQ4A). The installed internal build is signed by Delta Mind GmbH (Q994DN23WB), with accepted and stapled app/DMG notarizations. Isolated mounted-DMG verification passes. Receipts: `~/Downloads/OpenApe-Pods-29447001/`; paired rollback: `~/Library/Application Support/OpenApe Pods Rollback/2026-09-24-105317-issue-1377`.

Actual installed MCP saved the IURIO description and Telegram destination immediately, assigned Azure GET and Telegram POST through authentic grants, and retired the superseded variable proposal. The existing account flow established the once-per-account Pods provider connection. The actual UI contains no embedded chat or review queue. All six Pods retain their prior names, revisions and lifecycle; the owner's Codex configuration is unchanged. The draft includes the assigned HTTP capabilities at revision 2. Live acceptance still awaits the Azure credential requested through OpenApe Secrets, then validation/activation and actual delivery. The monitor remains paused and its 15-minute schedule disabled; milestone 4 and this plan remain open for that missing input.
