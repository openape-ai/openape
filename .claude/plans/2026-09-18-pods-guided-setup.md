# Plan: Complete Pod setup from chat

## Purpose / Big Picture

Make recognized setup requirements actionable directly from the Pod conversation. An owner can review a concrete HTTP destination, directory access, application and command, or enter an ordinary missing value. Secrets stay in the encrypted credential form; chat explains where to obtain them. A partial or interrupted setup must never look complete.

Scope includes structured proposals, existing owner approval flows, contextual follow-up guidance, accurate script state, and resumable interrupted setup. No real mail, LLM or Telegram calls for verification; no schedule activation; preserve owner data. Publishing uses the canonical native PR workflow already authorized by Patrick.

## Repository orientation

Checkout: /Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo.worktrees/pods-conversation
Branch: bugfix/issue-1354-chat-setup, based on canonical main 0f7425539c81950e54882bd851190f58e9011302.
Issue: https://git.openape.ai/openape-ai/openape/issues/1354.
Vue/Electron/TypeScript application in apps/openape-pods. Contracts define model and owner commands; worker/master handles chat and drafts; main/app.ts retains native permission confirmation; renderer/MasterChat.vue renders conversation and setup cards. SQLite stores proposals, messages and script drafts.
Every package shell starts with `. ./scripts/activate-node.sh`. Native builds use `DEVELOPER_DIR=/Library/Developer/CommandLineTools`.

## Milestones

### 1. Actionable setup

Extend structured proposals with directory path/access, HTTP methods, concrete program arguments, ordinary missing values and setup instructions. Show review forms from chat, prefilled with proposal fields. Reuse owner-controlled resource and program APIs; model tools cannot grant permissions. Preserve old proposals without guessing missing permission scope. Show resolved state only from actual assigned resources. No secret value crosses the model/chat boundary.

Acceptance: component and worker contract tests demonstrate HTTP review, directory/program selection, missing value input, cancellation, stale revisions and secret redaction. Existing records still render and are actionable.
Rollback: revert code on the feature branch; no destructive storage migration.

### 2. Honest progress and recovery

Make system instructions explicit about asking necessary follow-up questions, providing secret acquisition steps, saving real code before claiming success, and never storing placeholder values as completed setup. Show interrupted setup with a continue action and actual persisted script state. Remove automatic sample code from an empty editor. Keep bounded chat execution while allowing legitimate multi-step setup to complete.

Acceptance: focused existing master/workspace tests and native synthetic setup exercise persistence, recovery, missing code and guidance. No live provider calls.
Rollback: revert code; retained conversation and draft records remain compatible.

### 3. Delivery

Run repository lint and typecheck, app build and targeted behavioral/native UI checks. Review actual screenshots. Commit and push to canonical origin, review native PR and required checks before merging. Install the local build with paired app/profile rollback and verify data and existing schedule preservation. The subsequent explicit merge/push authorization supersedes the earlier no-full-E2E constraint, as recorded in active-work.md; retain targeted development checks and use the normal required merge gate.

## Progress

- [x] 2026-09-18: Read current instructions and owner Pod state without mutations.
- [x] Confirmed four pending proposals, no script draft, no active script, placeholder telegram_chat_id, and interrupted master context after the fixed two-minute deadline.
- [x] Milestone 1: inline owner review, follow-up answers and protected secret routing.
- [x] Milestone 2: saved script status, bounded continuation and exact model routing.
- [ ] Milestone 3.

## Surprises & Discoveries

The owner assistant announced saving a draft but its turn timed out before any draft action. The editor automatically displayed starter code despite no saved script. requestAccess supports descriptions but not writable directory proposals or HTTP method fields, and its button only navigates to an empty permission list.

## Decision Log

- Keep existing permission and credential boundaries. An assistant proposal is not authorization.
- Store and review concrete fields; do not derive executable commands or write access from prose automatically.
- Keep secret acquisition guidance separate from secret values. Ordinary missing configuration can use a chat setup form.

## Outcomes & Retrospective

Implementation and focused verification complete; publishing and local installation remain. Full lint (51 tasks), typecheck (72 tasks), app build, 41 focused unit/component tests and 16 native cases passed. DE/EN and narrow dark screenshots inspected. Permanent tests cover approval/cancellation, stale state, secret isolation, missing scripts and exact model routing. Patrick explicitly approved the plan on 2026-09-18. Additional owner request: allow choosing GPT-6 Astra for Pod creation. Add a persisted chat model selector, bundle the actual model catalog entries, and assert the outbound model with a synthetic provider; keep scheduled execution model unchanged.
