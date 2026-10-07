# Handoff: Pods mobile inbox, M2 (October 7, 2026)

Issue: https://repos.openape.ai/patrick/monorepo/issues/1446 · Plan (approved revision 2, publication v6): https://report.openape.ai/d/01M4B5Q1Q0W6C97A4ZXTFZ5WJR?v=6 · Plan source: `.claude/plans/2026-10-07-pods-ios-inbox/plan.json` (section `m2-design` holds the M2 design).

## Checkout

- Absolute path: `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo/.claude/worktrees/pods-inbox-pwa-m0-faca9e`
- Branch: `feature/issue-1446-inbox-decisions`, based on main `18fab73d` (merge of PR 301). This handoff commit adds only the plan source for v6 (M2 design section, M2 `active`), the publication receipt and this file. **No M2 code exists yet.**
- Toolchain per shell: `export PATH="/Users/patrickhofmann/Companies/private/repos/openape/.toolchains/pnpm/10.29.3/bin:$PATH"; . ./scripts/activate-node.sh`. Native issue/PR CLI needs `pnpm --filter @openape/cli-auth build` once per fresh worktree (else AUTH_REQUIRED).
- External CI is paused by owner decision (issue 1448, PR 296): merge native PRs after local checks; never wait for or re-enable CI without a new owner decision.

## Milestone status

- **M0 done (owner-accepted).** Prototype `/inbox/` live on pods.openape.ai (PR 293, hotfix PR 295). Owner tested on an iPhone 11 Pro Max (Safari 26.6.1 UA) and waived the two-day series: "Das scheint alles zu gehen. Wir machen weiter ohne 2Tage Test". Evidence: https://report.openape.ai/d/01M4BAS8MHWA6FB4E8W29801WK and https://report.openape.ai/d/01M4BBDR0M5AP1RFHBBKYFX5XW. Open device finding for M5/M6: service-worker `shown`/`clicked` receipts and push-tagged `opened` were never recorded on iOS (declarative push likely bypasses the worker handlers).
- **M1 done, live** as relay `prod-1e467932` with `NUXT_INBOX_ENABLED=true` (PR 298; security follow-ups PR 299 and PR 300: inbox devices only from inbox-started DDISA sign-ins, cookie path `/` so sign-in/logout revoke them). Owner API `/inbox/api/v1/*`, runtime publication `POST /api/runtime/v1/inbox`, store `apps/openape-pods-relay/server/utils/inbox-store.ts`, session logic `inbox-service.ts`. Details: `docs/operations/pods-mobile.md`.
- **M3 merged, not installed** (PR 301, `18fab73d`): `context.notify` → worker `inbox_outbox` (schema 41) → `RemoteController.deliverInbox()` every 15 s. Needs a signed desktop build; deliberately bundled with M2 so the owner's running Pods app restarts once.
- **M2 active (design only).** M4–M7 open. The M0 prototype (`/inbox/` pages, `/inbox/api/*`, `inbox-prototype.sqlite`) stays until M4 replaces the UI.

## M2 findings that decide the implementation

- The desktop inbox (`apps/openape-pods/src/renderer/central/LocalShell.vue` → `DecisionsInbox.vue`) loads exactly five main-process calls: `window.pods.workspace({type:'map'})`, `networks({type:'list'})`, `workflows({type:'list'})`, `master({type:'list'})`, `secrets({type:'list'})`. It emits these owner commands: network `choose`, `gateOpen`, `gateDiscard` (with `evidence`); workflow `gateChoose`, `gateOpen`, `gateDiscard`; runs `openApproval`, `resolveHttp` (`applied`, `evidence`); secrets `cancel`; master `decline`; plus `open` (navigate to Pod).
- Main-process entry points: `Worker.networks` (`src/main/worker.ts:626`), `Worker.workflows` (`:640`), `Worker.runs` (`:561`), `Worker.master` (`:493`), `Worker.secrets` (`:250`), `Worker.centralExecute` (`:688`); the map comes through `worker.request(parseCommand(command))` (`src/main/app.ts:387`). `gateOpen`/`openApproval` call `shell.openExternal` on desktop; the phone must instead receive the verified HTTPS IdP URL (`approvalURL()` in `src/contracts/activity.ts:21`, network gate `url`, graph batch `url` after `approvalUrl()` in `src/worker/workflows/gates.ts:229`).
- Not in the central snapshot today: network choices, network approval batches, secret requests, recomputed proposal state. Central allowlist `parseCentralCommand` (`src/contracts/central.ts:111-128`) has no channel for these decisions; `resolveHttp` via central bypasses the desktop confirmation dialog (`src/main/app.ts:~407`).
- Relay operation pipeline: `workspace().submit(owner, runtimeId, revision, command, id)` (`apps/openape-pods-relay/server/utils/workspace-store.ts:364`), claim/execute in `src/main/central/controller.ts:293-347`, result via `operation()`/`visibleOperation()`.

## Next concrete step

Implement M2a in a main-process module (for example `apps/openape-pods/src/main/inbox/decisions.ts`):

1. `collectDecisions(worker)` builds normalized entries from the five calls above: `sourceId` (e.g. `network-choice:<eventId>:<gate>`, `network-gate:<taskId>:<generation>`, `workflow-held:<workflowId>:<gate>:<itemId>`, `workflow-batch:<batchId>`, `approval:<runId>:<grantId>`, `effect:<podId>:<runId>:<key>`, `secret:<id>`, `proposal:<id>`), Pod, bounded title/context, options, authority (`pods`/`idp`/`secrets`), HTTPS handoff link, and whether evidence is required.
2. Publish the full set when its digest changes, through `RemoteController` (signed) to the relay. Add a relay route (or a `type` on `POST /api/runtime/v1/inbox`) that upserts `kind='decision'` items per runtime in `InboxStore` (push-outbox entry for new ones, vanished ones become resolved).
3. Add `POST /inbox/api/v1/items/:id/decide {option, evidence?, requestId}` that submits a new central command (e.g. channel `inbox`, body `{type:'decide', sourceId, option, evidence}`) via `workspace().submit`. In `Worker.centralExecute`, recompute the projection, find the `sourceId` and run the same command `DecisionsInbox.vue` would emit; unknown or changed source → clear error. Return the operation state to the phone.
4. Tests: extend `test/main/remote-controller.test.ts` (real relay code) and the relay unit suite; keep `pnpm --filter @openape/pods test` green (1320 tests at `18fab73d`).

M2b afterwards: setup-proposal accept (`resolveSetup`/`answerSetup`) and network `gateReview` exclusions. Then one signed desktop build with M2 + M3 (see vault note `pods-signed-release-pitfalls`), relay deploy, and plan/Test Run updates.

## Checks

- Done at `18fab73d`: relay unit 49/49, Pods unit 163 files/1320 tests, lint (existing Vue warnings only), typecheck, pre-commit/pre-push affected unit checks; relay `test:e2e` inbox assertions pass, the run still fails afterwards at the pre-existing browser-workspace heading check (separate task suggested); real-Chromium cookie-revocation check (evidence in PR 300).
- Open: signed desktop build and production delivery of `context.notify`; all M2 checks; M4–M7; iOS receipt diagnosis (M5).

## Housekeeping

- No background processes of this session are running; temporary harness files (`e2e/zz-*.test.ts`, `zz-*.mjs`) were removed.
- chatty: Traefik backup `~/traefik-backups/pods-idp.yml.20261007155320`; relay `.env` backup in `shared/backups/env-before-inbox-1446-*`. Actions-cache blobs older than 24 h were deleted once on October 7; a recurring cleanup is an open owner decision (issue 1448).
