# Handoff: Pods mobile inbox, M2 (October 7, 2026)

> Historical. M2 and M3 were delivered on October 7, 2026 (relay `prod-3c08d3c7`, signed desktop `3c08d3c7`). Current state: [pods-inbox-m4-handoff.md](pods-inbox-m4-handoff.md) and [active work](active-work.md).

Issue: https://repos.openape.ai/patrick/monorepo/issues/1446 · Plan (approved revision 2, publication v6): https://report.openape.ai/d/01M4B5Q1Q0W6C97A4ZXTFZ5WJR?v=6 · Plan source: `.claude/plans/2026-10-07-pods-ios-inbox/plan.json` (section `m2-design` holds the M2 design).

## Checkout

- Absolute path: `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo/.claude/worktrees/pods-inbox-pwa-m0-faca9e`
- Branch: `feature/issue-1446-inbox-decisions`, based on main `18fab73d` (merge of PR 301). The handoff commit `e1cddf79` added the plan source v6 and this file; the following commit adds M2a (see below).
- Toolchain per shell: `export PATH="/Users/patrickhofmann/Companies/private/repos/openape/.toolchains/pnpm/10.29.3/bin:$PATH"; . ./scripts/activate-node.sh`. Native issue/PR CLI needs `pnpm --filter @openape/cli-auth build` once per fresh worktree (else AUTH_REQUIRED).
- External CI is paused by owner decision (issue 1448, PR 296): merge native PRs after local checks; never wait for or re-enable CI without a new owner decision.

## Milestone status

- **M0 done (owner-accepted).** Prototype `/inbox/` live on pods.openape.ai (PR 293, hotfix PR 295). Owner tested on an iPhone 11 Pro Max (Safari 26.6.1 UA) and waived the two-day series: "Das scheint alles zu gehen. Wir machen weiter ohne 2Tage Test". Evidence: https://report.openape.ai/d/01M4BAS8MHWA6FB4E8W29801WK and https://report.openape.ai/d/01M4BBDR0M5AP1RFHBBKYFX5XW. Open device finding for M5/M6: service-worker `shown`/`clicked` receipts and push-tagged `opened` were never recorded on iOS (declarative push likely bypasses the worker handlers).
- **M1 done, live** as relay `prod-1e467932` with `NUXT_INBOX_ENABLED=true` (PR 298; security follow-ups PR 299 and PR 300: inbox devices only from inbox-started DDISA sign-ins, cookie path `/` so sign-in/logout revoke them). Owner API `/inbox/api/v1/*`, runtime publication `POST /api/runtime/v1/inbox`, store `apps/openape-pods-relay/server/utils/inbox-store.ts`, session logic `inbox-service.ts`. Details: `docs/operations/pods-mobile.md`.
- **M3 merged, not installed** (PR 301, `18fab73d`): `context.notify` → worker `inbox_outbox` (schema 41) → `RemoteController.deliverInbox()` every 15 s. Needs a signed desktop build; deliberately bundled with M2 so the owner's running Pods app restarts once.
- **M2 active: M2a and M2b implemented on this branch.** One owner decision open (new HTTPS grants from the phone). M4–M7 open. The M0 prototype (`/inbox/` pages, `/inbox/api/*`, `inbox-prototype.sqlite`) stays until M4 replaces the UI.

## M2 findings that decide the implementation

- The desktop inbox (`apps/openape-pods/src/renderer/central/LocalShell.vue` → `DecisionsInbox.vue`) loads exactly five main-process calls: `window.pods.workspace({type:'map'})`, `networks({type:'list'})`, `workflows({type:'list'})`, `master({type:'list'})`, `secrets({type:'list'})`. It emits these owner commands: network `choose`, `gateOpen`, `gateDiscard` (with `evidence`); workflow `gateChoose`, `gateOpen`, `gateDiscard`; runs `openApproval`, `resolveHttp` (`applied`, `evidence`); secrets `cancel`; master `decline`; plus `open` (navigate to Pod).
- Main-process entry points: `Worker.networks` (`src/main/worker.ts:626`), `Worker.workflows` (`:640`), `Worker.runs` (`:561`), `Worker.master` (`:493`), `Worker.secrets` (`:250`), `Worker.centralExecute` (`:688`); the map comes through `worker.request(parseCommand(command))` (`src/main/app.ts:387`). `gateOpen`/`openApproval` call `shell.openExternal` on desktop; the phone must instead receive the verified HTTPS IdP URL (`approvalURL()` in `src/contracts/activity.ts:21`, network gate `url`, graph batch `url` after `approvalUrl()` in `src/worker/workflows/gates.ts:229`).
- Not in the central snapshot today: network choices, network approval batches, secret requests, recomputed proposal state. Central allowlist `parseCentralCommand` (`src/contracts/central.ts:111-128`) has no channel for these decisions; `resolveHttp` via central bypasses the desktop confirmation dialog (`src/main/app.ts:~407`).
- Relay operation pipeline: `workspace().submit(owner, runtimeId, revision, command, id)` (`apps/openape-pods-relay/server/utils/workspace-store.ts:364`), claim/execute in `src/main/central/controller.ts:293-347`, result via `operation()`/`visibleOperation()`.

## M2a and M2b as implemented

- Contract `apps/openape-pods/src/contracts/inbox.ts`: `InboxDecision` (`sourceId`, `type`, `digest`, Pod, title/body, `authority` `pods`/`idp`/`secrets`, options with `input` `evidence`/`value`/`null`, HTTPS `link`; no option and no link = explicit desktop step). Central command `{ channel: 'inbox', body: { type: 'decide', sourceId, digest, option, input? } }` is accepted **only** by `parseInboxCentralCommand`: `parseCentralCommand` (browser, Codex MCP `workspace submit`, runtime submit) rejects it; the relay creates it only in `WorkspaceStore.submitDecision`, and `Worker.centralExecute` handles it before the general parser.
- Desktop `apps/openape-pods/src/main/inbox/decisions.ts` (`InboxDecisions`): network choices (latest event per case), network batches (`discard` for unknown, `review` → `gateReview` for unknown/superseded, both with evidence; IdP link), workflow held items and batches, runtime approvals (link verified through `Worker.approvalLink`; unverifiable ones are not published), unknown deliveries (evidence; **network members stay a desktop step** because `resolveHttp` bypasses network recovery), secret requests (cancel + Secrets link), setup proposals (variable → `answerSetup` with typed value; an already assigned matching resource → `resolveSetup` via shared `setupResourceMatches` in `contracts/setup.ts`; credential → scoped Secrets request; everything else → decline + desktop step). Setup proposals of **network members** are always a desktop step (member changes require desktop review); gate decisions for a network remain decidable. `decide` re-reads all sources and fails with "no longer waiting" / "changed" / "not available" / missing input. The publication is capped at 1 MiB.
- Publication: `RemoteController.publishDecisions` posts the full set signed to `POST /api/runtime/v1/inbox/decisions` on digest change (at least every 10 min); `app.ts` runs it every 10 s while the central workspace is online; a full inbox is logged.
- Relay: `InboxStore.syncDecisions` (new → item + push entry; changed → update; vanished → `resolved`, pending push removed; owner-deleted open decisions keep their tombstone until resolved; a full inbox skips new decisions and still resolves), `openDecision`; `WorkspaceStore.submitDecision`/`existingOperation`; routes `POST /inbox/api/v1/items/:id/decide {option, input?, digest, requestId}` (retry with the same request id returns the existing operation; the digest must equal the stored one the phone displayed, else 409 `decision_changed`; option/input validated; waits up to 10 s for a busy workspace) and `GET /inbox/api/v1/operations/:id`. Item JSON carries `decision.{sourceId,digest,type,authority,options,runtimeId}`.
- Review: an independent Claude review found seven defects (inbox command reachable from MCP/browser, network-member `resolveHttp`, digest not bound to the phone, publication size, retry after resolution, tombstone purge resurrection, quota aborting sync); all fixed with tests.
- Not done, owner decision needed: accepting an HTTPS proposal whose destination is **not yet granted** would make the desktop approve a new IdP grant with the owner bearer, triggered from the phone instead of the desktop dialog (`Worker.resources assignHttp` → `connections.approve`). It stays a desktop step until the owner decides.

## Next concrete step

Owner decision on new HTTPS grants from the phone. Then one signed desktop build with M2 + M3 (vault note `pods-signed-release-pitfalls`), relay deploy (`NUXT_INBOX_ENABLED` already on), one real decision from the phone through the API, then M4 (UI renders `kind=decision`, sends `digest`, polls `operations/:id`, refreshes after an IdP/Secrets return).

## Checks

- Done at `18fab73d`: relay unit 49/49, Pods unit 163 files/1320 tests, lint (existing Vue warnings only), typecheck, pre-commit/pre-push affected unit checks; relay `test:e2e` inbox assertions pass, the run still fails afterwards at the pre-existing browser-workspace heading check (separate task suggested); real-Chromium cookie-revocation check (evidence in PR 300).
- M2 (M2a + M2b + review fixes), on top of `e1cddf79`: root lint (55 tasks) and typecheck (78 tasks), Pods unit 164 files/1,337 tests, relay unit 52/52, Pods and relay builds; relay `test:e2e` passes the new decision block (input validation, digest mismatch, idempotent retry, operation receipt) and the account-switch check, then still fails at the pre-existing browser-workspace readiness check (`verifyBrowserWorkspace`). A further IdP sign-in in that E2E hits the IdP's 10/min login limit (429); reuse the existing inbox session there.
- Open: HTTPS-grant decision; signed desktop build and production delivery of `context.notify` and M2; M4–M7; iOS receipt diagnosis (M5).

## Housekeeping

- No background processes of this session are running; temporary harness files (`e2e/zz-*.test.ts`, `zz-*.mjs`) were removed.
- chatty: Traefik backup `~/traefik-backups/pods-idp.yml.20261007155320`; relay `.env` backup in `shared/backups/env-before-inbox-1446-*`. Actions-cache blobs older than 24 h were deleted once on October 7; a recurring cleanup is an open owner decision (issue 1448).
