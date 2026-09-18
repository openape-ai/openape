# Plan: Central OpenApe account in Pods

## Purpose / Big Picture
The owner approved this design on September 19: sign in once in the app, show the account and its status persistently, explicitly choose the default owner for new Pods, and preserve existing Pod identities and individual grants. ChatGPT and application credentials remain separate. This changes account selection and presentation, not the DDISA protocol.

## Repository orientation
Checkout: openape-monorepo.worktrees/pods-conversation. Branch: feature/issue-1354-central-account, based on canonical main bca8ecc7. Issue: https://git.openape.ai/openape-ai/openape/issues/1354.
The Electron app uses Vue, typed preload IPC, a main-process ConnectionManager, and a SQLite worker OnboardingStore. Existing PodIdentityManager and shellIdentity supply isolated agent credentials to apes.

## Milestones
1. Persist an explicit default owner in onboarding, validate owner-only selection, and refuse reassignment of an unavailable existing owner. Preserve identity metadata during reconnect. Existing profiles start without a selected default; owners choose it once, without changing existing Pods.
2. Add a persistent account entry, account selection/status, reconnect, and advanced issuer settings. Explain separate provider connections and the effect of disconnecting. Keep account tokens outside renderer/chat.
3. Extend existing onboarding component, manager, storage and native suites; verify default persistence, selection isolation, revoked owners and visible narrow/dark UI. Run full lint/typecheck, app build, unit tests and focused synthetic native checks. No live model/mail/Telegram calls or schedule activation.
4. Review and publish via the native PR workflow, then package and locally install with a paired application/data rollback. Preserve owner data and existing schedule settings. Required merge checks must pass.

## Rollback
Before installation keep the old app with a consistent profile backup. Schema 19 only adds nullable onboarding.default_owner; rollback uses the paired old profile because old apps reject newer schemas. Never delete user data or reconnect/reassign accounts on the owner's behalf.

## Progress
- [x] 2026-09-19: Approved design recorded; clean checkout and canonical main verified.
- [x] Account persistence and UI.
- [x] Verification and visual evidence: full lint/typecheck, app build, 259 unit/component tests and five focused native tests; English/German and narrow dark screenshots inspected.
- [ ] Native PR, merge and local install.

## Decisions
- Existing bindings take precedence even when disconnected; no fallback to another owner.
- Default selection is an explicit owner action and applies at first identity provisioning.
- Browser sign-in reuses the existing connection when reconnecting, retaining Pod bindings.

## Outcomes
Pending implementation.
