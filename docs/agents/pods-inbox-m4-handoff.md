# Handoff: Pods mobile inbox, M4 (October 7, 2026, 18:30 CEST)

Issue: https://repos.openape.ai/patrick/monorepo/issues/1446 · Plan (approved revision 2): https://report.openape.ai/d/01M4B5Q1Q0W6C97A4ZXTFZ5WJR — latest publication v7 (stale, see below) · Plan source: `.claude/plans/2026-10-07-pods-ios-inbox/plan.json` · Previous handoff: `docs/agents/pods-inbox-m2-handoff.md`.

Committed with the first M4 change on `feature/issue-1446-inbox-pwa` (worktree `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo.worktrees/pods-inbox-m4`). The checkout section below describes the state at the start of M4; current status lives in [active work](active-work.md).

## Checkout

- Absolute path: `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo/.claude/worktrees/pods-inbox-pwa-m0-faca9e`
- HEAD: **detached at `3c08d3c75de54064c37c3e3d3485025ec9b5ea24`** = `origin/main` = merge of PR 302. It was detached deliberately for the clean deployment build. Working tree is clean apart from this file (verify with `git status`).
- Branch `feature/issue-1446-inbox-decisions` (head `b34b0c48`) is merged; do not reuse it. Start M4 on a new branch from `origin/main`, e.g. `feature/issue-1446-inbox-pwa`.
- Build leftovers inside the tree are ignored output: `apps/openape-pods/release/distribution/OpenApe-Pods-0.1.2-arm64-signed-local.dmg` (installed artifact) and `apps/openape-pods/.artifacts/data-dmg.png`.
- Toolchain per shell: `export PATH="/Users/patrickhofmann/Companies/private/repos/openape/.toolchains/pnpm/10.29.3/bin:$PATH"; . ./scripts/activate-node.sh`. Native PR CLI: `pnpm git:cli -- pr create|comment|merge …` (no issue-comment command; issue comments need the API with token exchange).

## Delivered state (verified October 7, 18:18–18:25 CEST)

- **M0** accepted by the owner (iPhone 11 Pro Max; two-day series waived). Prototype `/inbox/` still live (flag `NUXT_INBOX_PROTOTYPE_ENABLED`, own DB `inbox-prototype.sqlite`) until M4 replaces it.
- **M1** live: owner API `/inbox/api/v1/*`, inbox DB, device sessions (`NUXT_INBOX_ENABLED=true`).
- **M2 + M3** merged in PR 302 / PR 301 and **delivered**:
  - Relay `registry.openape.ai/openape-pods-relay:prod-3c08d3c7` (previous `prod-1e467932` for rollback); `pnpm check:ci` SUCCESS beforehand; health gate passed.
  - Signed-local desktop 0.1.2 from clean `3c08d3c7`, notarized (submission `52217bd0-0de4-461f-82ef-83d5aa724a2d`), DMG SHA256 `77b9799f73e2fda36ae567dd340848fd16ed6dc5828a5f00752121c801503354`, mounted acceptance passed. Installed over clean `7829011e`; schema 40 → 41; 38 Pods, 82 scripts, 70 resources, 7 schedules (4 enabled), 1 network, 5 workflows, 66 credential files unchanged. Runtime `a2521095-eaee-4c92-9214-d3988ef3430d` online.
  - Paired rollback (app + byte-identical profile): `/Users/patrickhofmann/Library/Application Support/OpenApe Pods Rollback/20261007-181757-inbox-m2-1446`. Never open the schema-41 profile with the old app.
  - Relay inbox afterwards: 20 open `decision` items, all `network-choice` (read-only query in the container). **No production decision has been executed**; that is the owner's action.
- Owner decisions on M2: new HTTPS grants are **not** accepted from the phone (stay a desktop step); IdP approvals are confirmed by the owner on id.openape.ai, also from the phone.

## Evidence and receipts

- M2 Test Run (tested `3c3bafec`): https://report.openape.ai/d/01M4BET0CNZSNKH7RJ3GQS32DZ
- Rollout Test Run (relay, DMG, install, counts, publication): https://report.openape.ai/d/01M4BJNYSN1TQPM4RKG81YW5Z0
- PR 302 comments: merge receipt + HTTPS owner decision `01M4BGDVHAGMB5N9VN8JC041DT`; rollout receipt `01M4BJPEA2GXGXTGQN33CE2HVV`. Issue 1446 has **no** comment for M2/M3 yet.
- Vault: `pods-native-mobile-m2.md` (M2 facts), `pods-internal-release-0.1.2.md` (current desktop/relay).

## Approvals and limits that still apply

- Plan revision 2 approved by the owner on October 7 ("super - wir legen los mit diesem plan in einer frischen session"): PWA first, service-readable account inbox, M1–M7.
- External CI paused by owner decision (issue 1448): merge native PRs after local checks; never wait for or re-enable CI without a new owner decision. Run `pnpm check:ci` before deployments. In this session, an auto-mode classifier blocked an unprompted `pr merge`; the merge was done after the owner's explicit "merge PR 302".
- Pods never approves grants (DDISA requester ≠ approver); IdP/Secrets decisions only hand off verified HTTPS links. The inbox central command must stay outside `parseCentralCommand` (browser/MCP/runtime); only `WorkspaceStore.submitDecision` creates it.
- Network-member deliveries (`resolveHttp`) and network-member setup stay desktop steps; setup acceptance from the phone only without local interaction.
- Relay deployments go first when a change touches `contracts/central.ts` or relay contracts (vault `pods-rollout-relay-first`). Signed desktop installs restart the owner's app: back up app + profile, verify counts and `online` afterwards.

## Stale documents to update in the first M4 PR

- `plan.json` (v7): `completion.summary`, `handoff` and the last changelog entry still say the signed build/relay deployment is next; milestones M2 and M3 still `active`. Update: M3 delivered; M2 delivered, its acceptance (a real phone decision) completes with M4; add changelog entry for the October 7 rollout; keep German translations in sync (`translations.entries` paths `completion.summary`, `handoff`, `changelog.N.text`). Render with `ape-report-render plan` and publish v8 with `ape-reports publish … --document 01M4B5Q1Q0W6C97A4ZXTFZ5WJR --expected-version 7 --category Plans --tag pods --tag mobile --tag pwa --meta plans.status=active`; store the receipt in `publication.json`. Plan JSON uses `indent=1`, no trailing newline.
- `docs/agents/active-work.md` (issue 1446 section): still lists "Next: signed desktop build M2+M3, relay deploy…".
- `docs/agents/pods-inbox-m2-handoff.md`: "Next concrete step" is done; mark it historical or point to this file.

## M4 entry (plan: "Build the focused installed web app")

Goal: Decisions and Notifications in a mobile installed web app, independent of the full workspace. Acceptance: both tabs, an actual completed decision, a full notification, restored read state after restart/reinstall; offline caches never leak between accounts; small-screen/large-text/VoiceOver; offline and revoked views without misleading active controls. Rollback: disable the mobile route, previous asset/service-worker version, no loss of server inbox data.

Existing pieces (relay `apps/openape-pods-relay`):
- M0 prototype UI to replace: `app/pages/inbox/index.vue`, `app/pages/inbox/item/[id].vue`, `public/inbox/{manifest.webmanifest,sw.js,icon-*.png}`; prototype API `server/routes/inbox/api/[...path].ts` + `server/utils/inbox-prototype.ts`, `inbox.ts` (prototype push dispatcher), `server/plugins/inbox-prototype.ts`.
- M1/M2 API `server/routes/inbox/api/v1/[...path].ts` (session via `inbox-service.ts`, cookie `pods-inbox`, path `/`):
  - `GET session` → issuer, subject, device, `vapidPublicKey`; `GET items?kind=message|decision&archived=1&before=` (page 50, `next`); `GET changes?after=` (cursor sync incl. tombstones); `GET items/:id`; `PATCH items/:id {read?, archived?, deleted?}`; `GET devices`, `POST devices/:id/revoke`, `POST logout`; `POST push/subscribe|unsubscribe` (M5).
  - `POST items/:id/decide {option, input?, digest, requestId}` → `{operation}`; send the **digest the phone displayed** (`item.decision.digest`); reuse the same `requestId` on retry. Errors: `decision_changed` (409, refresh), `decision_resolved` (409), `invalid_inbox_option`, `invalid_inbox_input`, `pod_offline` (Mac offline → action unavailable), `workspace_busy` after a 10 s wait.
  - `GET operations/:id` → poll `accepted → started → applied | failed` (`error` carries the desktop's message, e.g. "This decision is no longer waiting").
- Item shape (`server/utils/inbox-types.ts`): `kind`, `state` (`open`/`resolved` for decisions), `title`, `body`, `pod`, `links` (decision handoff link is `links[0]`), `decision: {sourceId, digest, type, authority, options[{key,title,input:'evidence'|'value'|null}], runtimeId}`. No options and no link = explicit desktop step (body explains it). `authority: idp|secrets` items are decided outside: open the link, refresh on return.
- Contract source of truth for decision types: `apps/openape-pods/src/contracts/inbox.ts`; desktop projection `apps/openape-pods/src/main/inbox/decisions.ts`.
- Notifications (`kind=message`) come from `context.notify` (M3), delivered every 15 s by the desktop.
- Device facts from M0: iOS needs a visible notification for every push and `focus()`/`openWindow()` immediately on tap; service-worker `shown`/`clicked` receipts and push-tagged opening were not recorded on iOS (declarative push) — M5 item. Sign-in return path lives in cookie `pods-inbox-return`; Nitro `routeRules` redirect `/inbox`→`/inbox/` self-redirect pitfall (issue 1447).
- Follow the AGENTS.md UI rules: component tests for visible Vue state, real-browser checks for geometry, inspected screenshots published as Test Runs; DE/EN strings.

## Known pitfalls

- Relay `pnpm test:e2e` passes the inbox and decision blocks, then fails at the pre-existing `verifyBrowserWorkspace` readiness check. Every extra IdP sign-in in that test risks the IdP 10/min login limit (429).
- `pnpm test:distribution --signed-local` blocks indefinitely on a macOS keychain prompt for the fixture's safe storage until it is confirmed at the Mac.
- Signing requires a fresh `pnpm build` of the exact clean HEAD (`dist/build-inputs.json`), then `pnpm exec node scripts/package.mjs --distribution --signed-local` with `OPENAPE_PODS_SIGNING_IDENTITY="Developer ID Application: Delta Mind GmbH (Q994DN23WB)"` and `OPENAPE_PODS_NOTARY_PROFILE=delta-mind-notary`.
- Never extract files from an app bundle into the repository root (an `asar extract-file package.json` overwrote the root `package.json` in this session; restored from Git).
- MCP `workspace inventory` returns ~130 KB; summarize it from the saved file.
- Setup proposals appear in the inbox only for Pods of the desktop chat context, exactly like the desktop Decisions view (`MasterService.view`).

## Background work

None. No background processes, monitors or scheduled tasks of the M2/M3 session are running.
