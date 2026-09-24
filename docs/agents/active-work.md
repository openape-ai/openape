# Active work

## Pods: connected Codex owner administration (September 24, 2026) — delivered

[Issue 1377](https://repos.openape.ai/patrick/monorepo/issues/1377), [approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3971H91PDY5XPHJP3696PZ7). Worktree `issue-1377-broker-capacity`; completion documentation branch `bugfix/issue-1377-completion-docs`.

Delivered: PR 113 (`56eb0366`) removed embedded chat and duplicate local approvals; PR 115 (`b17e2b54`) removed per-script secret selection and documented MCP CLI setup. PR 116 (`4f5977cb`) added explicit native CLI runtimes and corrected active-operation checks for consumed one-shot grants. PR 117 (`8af87e34`) makes current owner-assigned grants take precedence over stale run history. PR 118 (`8ac60bf0`) applies configured machine capacity to broker assertions. All exact-source CI/E2E/layout checks passed; full local checks passed before distribution and deployment.

Signed/notarized desktop source `347b869d` is installed and its mounted-DMG check passed. All six Pods and real Codex settings were preserved. Receipts: `~/Downloads/OpenApe-Pods-347b869d/`; paired app/profile rollback: `~/Library/Application Support/OpenApe Pods Rollback/2026-09-24-160638-issue-1377`. The formerly failing current Azure grant completed successfully in real run `b9a9627a-cb89-43e0-986b-b88bef5478ee`.

Owner IdP `prod-8ac60bf0` and Pods provider `prod-4f5977cb` are healthy with unchanged discovery/JWKS. Both machine limits are configured to 600; strict login limits are unchanged. The broker's previous independent 120-assertion bound caused the real HTTP 429 failures. Azure read and Pod runtime already use approved `always` grants; repeated status/token checks are not new approval requests. Owner IdP database backup passed SQLite quick_check at `/home/openape/projects/openape-free-idp/shared/backups/issue-1377-capacity-20260924T140829Z`; environment backups are under each service's `shared/backups/issue-1377-rate-20260924T135931Z`.

Reuse group `iurio` and Pod `98c32f74-ffaf-4628-bd41-95cea821572f`. Private Azure login and real PR reads are verified; no repeat login or PAT is needed. Telegram connection test `a2e8104b-07e2-40ca-8a4c-7430596fc6dd` completed and Patrick confirmed receipt. Full run `368a4b8e-6320-445e-a841-a7eb352549f5` completed all 39 PRs with 119 successful Azure reads and one confirmed Telegram baseline notification. Bounded retries cover transient read failures while preserving the prior baseline on failure. Follow-up `88c09e14-5ff2-49f8-8550-816dc31af162` completed another 119 reads with no changes and no Telegram message. The Pod is active with its 900-second schedule enabled at revision 2; checkpoint revision 10. Other Pods are unchanged. Receipts are recorded in `~/Downloads/IURIO-PR-monitor/TASK.md` and the issue. Never copy owner login stores or expose secret values.

## Pods installed Codex MCP dependency (September 24, 2026)

[Issue 1376](https://repos.openape.ai/patrick/monorepo/issues/1376). The signed `95fc9d87` installation exposed an external `croner` import in the unpacked MCP runtime; checkout-based acceptance resolved ancestor dependencies and missed it. The repair bundles the dependency and runs the existing packaged MCP case from an isolated path outside the checkout. That regression fails with the installed error before the fix and passes after it; full lint/typecheck and the app build pass. The issue records exact-source merge checks and refreshed signed installation evidence. Preserve the owner app/profile rollback pair.

## Pods: Codex controls the installed app (September 23, 2026) — done

[Issue 1375](https://repos.openape.ai/patrick/monorepo/issues/1375), [plan](../../.claude/plans/issue-1375-codex-control.md) (D1–D6 and option a approved by Patrick). Issue closed. PR 108 (adapter), PR 109 (MCP shim and launcher) and PR 110 (registration UI, **Prepared by Codex**, handbook chapter and packaged acceptance with a real `codex app-server`) are merged; PR 110 merged as `8aad8901`. The owner's real `~/.codex` and profile were never touched; all tests use isolated `CODEX_HOME` and fixture profiles. Installing on Patrick's Mac and connecting his Codex are his own steps in App settings.

## Pods test pyramid (September 23, 2026) — done

[Issue 1374](https://repos.openape.ai/patrick/monorepo/issues/1374), [plan](../../.claude/plans/issue-1374-test-pyramid-pods.md) with outcomes. PR 97–104 merged (main `94ca3550`), no production code changes. Pods E2E: 35 files / 135 tests / 72.6 s → 25 files / 109 tests / 27.9 s (CI, 6 workers); pods layout step 54.2 s. iOS client outside the check contract (PR 100, issue 1364). Which level proves what: `apps/openape-pods/docs/testing.md`. Issue closed. Follow-up PR 106 merged as `3cc7104e` (packaged E2E variants only, a leaner browser matrix and `pnpm --filter @openape/pods test:fast`, about 14 seconds without Electron). PR 107 merged as `b2b7002e` (pre-push runs only `check:affected --suite unit`; E2E and layout run externally once per head).

## Pods: two owner accounts (September 22, 2026)

[Issue 1372](https://repos.openape.ai/patrick/monorepo/issues/1372) (supersedes 1365). Worktree `wt-issue-1372`, branch `feature/issue-1372-two-owner-accounts`, base `b15b564a`. [Plan](../../.claude/plans/issue-1372-two-owner-accounts.md), approved by Patrick with D1 (Pods of another identity are re-provisioned under the owner), D2 (one-time Pods provider consent at the first Pod) and D3 (one email field, IdP from the DDISA DNS record).
"Your accounts" shows exactly Codex / GPT and the DDISA owner. Startup reconciliation keeps one row per provider, merges duplicate rows of the owner identity without re-provisioning and releases bindings of other identities. Mobile access and new Pods use the owner implicitly. Native [PR 96](https://repos.openape.ai/patrick/monorepo/pulls/96). Local evidence: 362 Pods unit/component tests, 8 packaged Electron onboarding/handbook E2E tests, lint and typecheck green. Installation on Patrick's Mac is a separate decision.

## Native mobile Pods (September 21, 2026)

[Issue 1362](https://repos.openape.ai/patrick/monorepo/issues/1362), [approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2ZQTVS90HK79ZWQW973Y8HP).
Patrick authorized end-to-end implementation; work resumed in Claude Code from the September 20 handoff. No milestone is accepted yet.

Foundation [PR 80](https://repos.openape.ai/patrick/monorepo/pulls/80) is merged as `131874cdd1a2ad8b4488e63ef6ca8356ea7cfdc0`. The relay packaging repair merged through [PR 82](https://repos.openape.ai/patrick/monorepo/pulls/82) as `8441c325e35fbda3bad43f5cf9ecfa6aa9e40df8` (external 4809/4810/4811 green; PR 81 is superseded and should be closed). `pnpm deploy:image pods-relay` from that clean main deployed `prod-8441c325` disabled: container 999:988, read-only root, `enabled: false`, provider discovery/JWKS/health byte-identical, reviewed Traefik router installed, stale `prod-131874cd` pin removed with backup. Verification policy decision: [issue 1363](https://repos.openape.ai/patrick/monorepo/issues/1363) / [PR 83](https://repos.openape.ai/patrick/monorepo/pulls/83) (affected pre-push, one external full contract, hidden fixture windows).

Native acceptance [PR 84](https://repos.openape.ai/patrick/monorepo/pulls/84) merged as `b4cff75b8a4cc1043872fef275f7e587825d8772` (source `e04cf8462c0e44c5aed1ff37182e17f476176fa8`, external 4821/4822/4823 green). Its push gate `1789985301982-e04cf846-all` ran every workspace including the native run from clean source; iPhone and iPad passed 2/2 with app restart, desktop restart and pairing removal (refused, no new run). Published evidence: https://testrun.openape.ai/r/aUeVd1ZWv-LKtO4bMdIadQxQ. Remaining M1 gaps: two distinct real broker/decision authorities in the native fixture (owner decision on a fixture-only loopback boundary), controlled live-model smoke (owner ChatGPT sign-in), physical-device HTTPS association.

Test-pyramid steps 1–3 are merged (PR 85 `80d62c57`, PR 86 `96b39096`). M2 (delivery, recovery, shared editing): [PR 87](https://repos.openape.ai/patrick/monorepo/pulls/87) (merge `e4499574`) and [PR 88](https://repos.openape.ai/patrick/monorepo/pulls/88) (merge `1f08c9ce`) deliver generation rotation after restore (unit + real-stack round trip), relay-reported pairing state, Retry-After, socket replacement/expiry/revocation, interrupted commands staying `unknown`, stale run refusal, per-runtime replay bounds and idempotent claims. Next: program-effect replay proof, review-conflict UI, native `RelayClient` tests with injected Keychain/URLSession, then the M2 acceptance run on the integrated stack before M3. Owner-blocked M1 gaps remain: two real authorities in the native fixture, live-model smoke, physical-device association.

## Central Pod chats (September 20, 2026)

Follow-up: Patrick requested model selection at the composer through `/` and
`/model`, following the [official Codex command pattern](https://learn.chatgpt.com/docs/reference/slash-commands).
The existing model catalogue and saved preference now use one searchable picker,
also opened by the compact model button beside +. Commands stay local, selection
preserves surrounding draft text, and running responses lock model changes.
The integrated base is `403ecf68` (PR 79); both concurrent work records are retained.
Previous source `a704411473bc8635746ad3df9c86f09b05538e7f` passed all local and
external gates. Follow-up checks and inspected UI evidence belong to PR 78's
exact-source acceptance record; these previous results do not certify a new head.

Issue: https://repos.openape.ai/patrick/monorepo/issues/1359. Native [PR 78](https://repos.openape.ai/patrick/monorepo/pulls/78). Worktree
`pods-central-chats`, branch `feature/issue-1359-central-chats`, canonical base
`934dbcec21cce8e3620ecda51a77aa8458bcfd30` (rechecked during implementation).
[Approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2ZACGJKS6JHH84T22Q48K49).
Chats is a sibling sidebar destination. The composer + selects explicit Pods
and one pinned workflow; context changes preserve history and start a fresh
provider session. Schema 21 retains legacy conversations and historical Pod
links. Reviewed local changes apply atomically, runs require a separate owner
action and retain actual run IDs. [Contracts](../../apps/openape-pods/docs/chats.md).

The shared coordinator is `worker/control/changes.ts` over existing domain
operations, with `contracts/control-api.ts` and authenticated owner-window IPC.
The separately planned MCP adapter must reuse this writer and existing native
approval surfaces; no MCP transport is introduced here. Saved Pod draft artifacts
remain available to selected chats; conversation text, composers and pending
change sets are separate. Stale changes require discard and deliberate preparation.

Implementation checkpoint `7540e3cc35932ba26c7a6a27af3d1ef4a6e25519` passed the
complete `pnpm check:ci` contract: full lint/typecheck, unit, web E2E and layout,
including 334 Pods unit/component and all 135 native tests with no skips.
Local summary: `.openape/check-results/1789910155897-7540e3cc-all/summary.json`.
[Inspected packaged UI](https://testrun.openape.ai/r/3Z4ctc_EDtxDgykTyQ2ckcKO)
covers + context selection, coordinated review and 1060/760/560 px layouts.
The existing self-contained HTML pipeline includes these screenshots.

Two existing native startup polls required an explicit 10-second readiness
window; functional assertions remain intact. An unrelated Git login-layout
check timed out once, then passed both its isolated run and complete unchanged
retry. Canonical main advanced during handoff to
`78fad3f1be6c3d67f2f68c50c8b142a0e9a06bb3` (PR 77, including real callback coverage
for that login path); it was integrated without conflicts or Pods code changes.
The combined final source must pass the same complete contract before push.
Final source/target SHAs, native diff review and external-check status belong to
the PR acceptance record. Next: review PR 78 after those exact-source checks;
merge, installation and live acceptance are separate decisions. No installed app,
owner profile, live mailbox, Telegram message or schedule activation was changed.
Troop/OpenClaw remains paused.

## Native issue pilot live (September 20, 2026)

[Issue 1356](https://repos.openape.ai/patrick/monorepo/issues/1356) now lives in the native forge. [PR 77](https://repos.openape.ai/patrick/monorepo/pulls/77), reviewed source `6b64f9ded062cc7e281117504fdc88e4b0f130cd` and target `934dbcec21cce8e3620ecda51a77aa8458bcfd30`, merged as `78fad3f1be6c3d67f2f68c50c8b142a0e9a06bb3` after all 17 local gates and exact-source external CI/e2e/layout passed. The approved private pilot activated at 13:36:53 UTC; Forgejo is now its read-only issue archive and unchanged Git/CI mirror.

The final import reconciled 233 issues, 175 comments, 15 labels, three attachment byte streams and 37 history rows. Nineteen unresolved assignments retain provenance without native permissions. All 110 inventoried Tasks/Plans/PR links resolve; actual DDISA login retains old comment anchors. Private intake and 17 product routes are active. Synthetic live acceptance records 1360/1361 are closed; tracking issue 1356 remains open through observation. Off-site snapshot `0cc0862b` independently restored 235 issues, 423 origins, 411 legacy links, all assets/archives and a Git clone. [Operational receipt](../operations/native-issues-migration.md#production-pilot-september-20-2026).

Closeout checkout: `native-issues-cutover`, branch `feature/issue-1356-native-issues-authority`, base `78fad3f1`. This change switches current guidance and CLI issue entry points, documents the bounded worker handoff and preserves original SQLite errors after automatic rollback. Eight retained operator contracts pass; full final-head gates and native PR review remain required. The extra rollback regression covers the observed production failure, atomicity and retry, rather than an implementation detail. Thirteen web app image deployments are healthy. Next: final closeout review, Docs entry point, guarded central configuration update and seven-day observation through September 27. Do not resume excluded workers, change installed Pods profiles or claim external-repository/public rollout completion.

Earlier entries below are dated implementation checkpoints; this receipt supersedes their monorepo issue authority statements.

## Pod workflow graphs and conservative mail filtering (September 20, 2026)

Issue: https://git.openape.ai/openape-ai/openape/issues/1358. Native [PR 76](https://repos.openape.ai/patrick/monorepo/pulls/76). Worktree
`pods-conversation`, branch `feature/issue-1358-pod-workflow-graphs`, canonical
base `77c6b22aa959b60402a22e4cc34700f74ebe8d47`.
[Approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2YXXAP6HC15CBQR5DV8XVHM).
Implemented first-class workflow graphs, independent schedules, atomic reservations,
immutable handoff/recovery, protected mail partners, frozen batches and durable
move/Telegram reconciliation. [Execution contract and disabled pilot](../../apps/openape-pods/docs/workflows.md).
Companion [CLI PR 8](https://git.openape.ai/delta-mind/o365-cli/pulls/8), source
`6617d2a6f14aa4d3df5eef2b1621eaf9ccbba05b`; vet/build/race tests pass.
Production autonomous archive remains blocked: Graph does not document the
required atomic conditional-move guarantee. Controlled transports prove local
recovery only. Restored mail scopes require a new quiet-baseline workflow.

Implementation commit: `2bfbdc34e649fb8ea8f5477a625c1a34417c6bc6`.
Reviewed native PR target: `77c6b22aa959b60402a22e4cc34700f74ebe8d47`;
the complete 79-file diff was available without truncation.
Full repository lint/typecheck, 312 Pods unit/component tests and app build pass.
Full `pnpm check:ci` passes on that commit, including all 134 native Pods tests:
`.openape/check-results/1789900150785-2bfbdc34-all/summary.json`.
[Inspected checkpoint report](https://testrun.openape.ai/r/r9EqNUJHuw5V-JIGRha12EAV).
The compact graph follow-up wraps at 760 px and asserts every node fits the
visible content width. Final source/target SHAs, complete gate results and the
latest visual evidence are recorded in PR 76's acceptance comment.
External forge checks are separate from this local evidence; do not merge until
they match the final source and succeed. Next: owner review of PR 76 and CLI PR 8;
then separate pilot setup and provider-concurrency decisions.
The concrete local review draft is
`apps/openape-pods/.artifacts/mail-workflow-pilot.json`; no Pod/application IDs
are invented and no protected partner or archive rule is silently approved.
No live profile, mailbox, Telegram delivery or schedule activation was changed.
The retired Troop/OpenClaw mail automation remains paused; its `kpi-mail` schedule
was read-only verified `enabled=false` at 2026-09-20T10:34:09Z.

## Pods user guide (September 20, 2026)

Issue: https://git.openape.ai/openape-ai/openape/issues/1357. Native [PR 75](https://repos.openape.ai/patrick/monorepo/pulls/75). Worktree
`openape-monorepo.worktrees/pods-user-guide`, branch
`feature/issue-1357-pods-user-guide`, canonical base
`cf19d3773f45dc9a5d8cd0cc8099fb5a76134cc0` (merged PR 74). Implementation
checkpoint: `e55edc4d98123a732c500fca61f25003448849c9`. [Inspected visual
evidence](https://testrun.openape.ai/r/TzIMdYOoh7dD-x10bUpV2Kfc).

The Apps generator now includes `/apps/pods` from the same English handbook
source and section renderer as the offline edition. Both English and German
handbooks explain current accounts/provider consent, saved chat setup, access,
manual verification, schedule catch-up, revocation and recovery. The internal
notarized build is explicitly not a public release. Twelve native screenshots
per language come from an isolated fixture without service calls or execution.

Verification: full lint (51 tasks), typecheck (72 tasks), Pods build and fixture
package, Docs build (179 prerendered routes), two generator contracts, two offline
browser cases and twelve scheduler tests passed. The affected unit contract
passed at `.openape/check-results/1789883759993-cf19d377-unit/summary.json`.
Desktop 1440px and narrow 390/560px renders, guide images, Apps navigation and
internal links were inspected. Raw browser evidence is in
`.openape/check-results/pods-guide/`; no full local E2E suite was run.

Next: native PR review and exact-source external CI/E2E/layout gates, then deploy
only Docs from clean canonical main using `pnpm run deploy:docs-site`. Record the
PR, reviewed source/target, final evidence and deployment result in its timeline.
Existing owner app/data/accounts and schedules remain untouched.

## Provider consent wording (September 19, 2026)

Issue: https://git.openape.ai/openape-ai/openape/issues/1354. Native [PR 74](https://repos.openape.ai/patrick/monorepo/pulls/74); worktree `pods-conversation`, branch `bugfix/issue-1354-provider-consent-wording`, implementation checkpoint `a79c94425e00d6f059eca56847b3a3cae6468b51`, canonical base `d5aa59c1a6df11189274ada1690b52f176899c4c`.

The provider action now says **Allow requests from this provider** and explains that consent uses the existing DDISA account without another provider sign-in. Confirmation/revocation, German translations and the operator workflow use permission terminology. Full lint/typecheck, app build, 267 unit/component tests and the single focused packaged provider-settings case pass; [inspected English/German and narrow dark evidence](https://testrun.openape.ai/r/FzY7KuWo0P6GAiNJnnni5VLD). No full local E2E suite or live provider test calls. Next: exact-source native review/checks, merge, notarized internal package and paired app/profile installation. The linked PR's delivery comment records final SHAs and preservation receipts.

## Personal accounts and per-Pod identities (September 19, 2026)

Issue: https://git.openape.ai/openape-ai/openape/issues/1354. Native [PR 73](https://repos.openape.ai/patrick/monorepo/pulls/73); worktree `pods-conversation`, branch `feature/issue-1354-pod-identity-settings`, implementation checkpoint `c9c590daf3cec69237bb9571a158bd1112a0a227`, canonical base `25529c59fe4d815232b98128fa8b1955684a96de`.

General account setup now contains personal DDISA and Codex / GPT sign-ins. The Pod Settings tab displays its actual agent identity and deciding owner, with issuer details and account-wide provider consent management collapsed below it. Scoped identity reads expose public fields without provisioning or moving existing bindings. Revocation confirmation explicitly covers all Pods using that consent.

Full lint/typecheck, app build, all 267 Pods unit/component tests and five focused native onboarding cases pass. Inspected English/German and narrow dark screenshots: [verification report](https://testrun.openape.ai/r/1awLyd__KmNbN_1Z07CHexCJ). No full local E2E suite or live mail/model/Telegram test call. Next: retain reviewed source/target SHAs, await exact-source external checks, merge, sign/notarize and install with a paired app/profile backup. The linked PR delivery comment is authoritative for final SHAs, signing and preservation receipts; earlier entries below are historical checkpoints.

## Pods server rollout and signed local installation (September 19, 2026)

Issue: https://git.openape.ai/openape-ai/openape/issues/1354. Server [PR 70](https://repos.openape.ai/patrick/monorepo/pulls/70) merged as `ce1a8fb87536fb471bbb01dce16884cf098be9d9` after all exact-source external checks passed. Both `id.openape.ai` and the independent `pods.openape.ai` run image pin `prod-ce1a8fb8`. HTTPS health, Grant Brokering 1.0 discovery, independent signing keys and refusal of unauthenticated writes pass. Existing owner identities, passkeys, signing keys and all 47,603 predeployment grant IDs/payloads are preserved.

Internal signing [PR 71](https://repos.openape.ai/patrick/monorepo/pulls/71), source `ad93686159a301a9b715a15cdba5cc0d3b20368b`, produced an Apple-accepted, stapled app and DMG. The installed app passes Gatekeeper and the mounted-DMG deterministic check. Four Pods, 107 runs, 13 encrypted credential files and the existing enabled schedule were retained. External candidate/public-release gates remain separate; `releaseReady` is false. No real mail/model/Telegram test request or schedule change.

Worktrees: `pods-conversation` (internal signing) and `pods-rollout` (clean canonical server deployment, then delivery evidence). Exact local checks, submissions, hashes and paired rollback locations: [delivery receipt](../../.claude/reports/2026-09-19-signed-rollout.md). Consult the linked native PRs for their final merge/check receipts. Next user step: explicitly connect the agent provider in Pods for new identities; existing Pods retain their bindings. Earlier implementation checkpoints below are historical.

## Federated Pods grants (September 19, 2026)

Implementation [PR 69](https://repos.openape.ai/patrick/monorepo/pulls/69), code source `40aeb4ba314bda319b0dd4ced2b4e377d42ab00e`. Issue: https://git.openape.ai/openape-ai/openape/issues/1354. Worktree: `pods-conversation`; branch `feature/issue-1354-federated-grants`; base `fe4432e5`. Approved plan: [grant brokering](../../.claude/plans/2026-09-19-grant-brokering.md). Protocol [PR 1](https://repos.openape.ai/patrick/protocol/pulls/1) merged as `25b6d89b8fc6c21f171df6c78cf6a30ca9f1ff99` and mirrored. Implementation adds durable owner consent, typed broker assertions, immutable external agent bindings, owner-only grant lifecycle, original signatures and direct owner-IdP consumption. Pods separates the agent provider from the deciding account; existing identities remain unchanged.

Full lint/typecheck, affected application builds, 2,136 unit/component/conformance tests and one focused native layout case pass; eight existing apes tests remain skipped. Evidence and precise commands: [verification](../../.claude/reports/2026-09-19-grant-brokering/verification.md). No full local E2E suite completed, real mail/model/Telegram request, schedule activation or owner-profile change. The default push hook unexpectedly entered E2E checks; it was interrupted during the second package. The push-only hook skip respects the local E2E restriction; native CI gates remain mandatory. Public `pods.openape.ai` has no DNS/service yet; deployment prerequisites are documented in [operations](../operations/grant-brokering.md). Next: review the native PR against its exact source/target and await required external checks, then merge and perform paired app/profile local installation. Do not claim a live federation deployment.

## Pods central OpenApe account (September 19, 2026)

Issue: https://git.openape.ai/openape-ai/openape/issues/1354. Worktree: `pods-conversation`; branch `feature/issue-1354-central-account`; base `bca8ecc7`. Owner approved central account management and explicit default selection. Implemented persistent sidebar identity, explicit default for newly provisioned Pods, advanced issuer settings, reconnect retaining existing bindings and refusal to transfer disconnected Pods to a different owner. Schema 19 adds nullable `onboarding.default_owner`; existing profiles require one explicit selection, without changing existing Pods or schedules. Full lint (51 tasks), typecheck (72 tasks), app build, 259 unit/component tests and five focused native tests pass. Synthetic-only English/German screenshots, including narrow dark mode, inspected. Native PR review, exact-source external checks, merge and local installation remain. Delivery receipts: `/Users/patrickhofmann/Companies/private/repos/openape/openape-pods/.claude/reports/2026-09-19-central-account/`.


## Native issues: implementation and cutover handoff

The approved private MVP is implemented through M1–M6. API/CLI, UI, product reporting, explicit PR relations and external-code issue homes are merged through native PRs 60–65; canonical checkpoint `d9c7d092e05496a472ef26f38f42c5e5d6c79b28` retains their sources and the full-byte Pods assertion correction. App entry points are reviewed in [PR 66](https://repos.openape.ai/patrick/monorepo/pulls/66); migration/restore tooling is reviewed in [PR 67](https://repos.openape.ai/patrick/monorepo/pulls/67). Read those PRs and the synchronized [approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2A5ZAT63A04PWGVBT5M14MW) for their current exact source, target, checks and merge receipts.

Current migration checkout: `native-issues-migration`, branch `feature/issue-1356-native-issues-migration`. Application/operator source `4cedf59baeb63b8312e36b9b6f8f76ba4bfad068` passes all 17 clean local gates at `.openape/check-results/1789756255457-4cedf59b-all/summary.json`: 181 Git app tests, six operator contracts, seven real IdP/CLI workflows and five actual browser workflows. The following documentation-only closeout does not change those feature contracts; normal final-head gates remain required. [Synthetic desktop/mobile evidence](https://testrun.openape.ai/r/SL61judviok6wU7oSMV8qU5X) contains 18 inspected screens. App entry-point source `dd8e77928d7742ad523d27703de01bacb8e31e95` also passes all 17 clean local gates, all 19 app builds and actual Pods menu checks.

The isolated source rehearsal reconciles 230 issues, 175 comments, 15 labels, three actual attachment byte streams and 37 history rows. Repeated/delta/interrupted import, complete mapping/provenance hashes, actual encrypted Restic restore and the packaged operator inside the existing Linux image pass without changing Git refs. Private source files remain ignored and restricted. No historical account receives native permissions automatically. The 19 assignment and 81 external-reference dispositions are rehearsal-only, not approved production exceptions.

Next: complete any outstanding exact-source merge gates in PRs 66/67, then the separately approved M7 cutover in the [migration runbook](../operations/native-issues-migration.md). The plan contains the concrete pilot recommendations and read-only host preflight. Production import/activation, source fencing/rebinding, compatibility routing, app flags and individual source-owner acceptance retain that gate. No production issue migration, feature activation, source gateway change or installed owner Pods profile mutation was performed by these implementation increments. Public/anonymous rollout remains deferred.

## Native issue reporting entry points (M4)

`native-issues-entrypoints`, branch `feature/issue-1356-native-issues-entrypoints`, base `9c523ee6`. All 19 app workspaces now have a product reporting entry: the Git app, fourteen web app footers, the Pods native Help menu and agent/Nest/chat CLI help. Web links use `NUXT_PUBLIC_ISSUE_REPORTING_ENABLED=true`; Pods uses `OPENAPE_PODS_ISSUE_REPORTING_ENABLED=1`; daemon/CLI help uses `OPENAPE_ISSUE_REPORTING_ENABLED=1`. Every new entry is off by default. Only the approved product key goes to the fixed native reporting URL; web referrers are suppressed. Full lint/typecheck, all app builds, shared-component browser checks and the real Electron menu flow pass. Native production rollout and source migration remain separately gated.


## Native issues — M4 external issue homes (September 18, 2026)

`openape-monorepo.worktrees/native-issues-apps`, branch `feature/issue-1356-native-issues-apps`, base `674de015` (M4 core). Adds fresh issue-only repository registration with an explicit external HTTPS code URL, private metadata and matching navigation. Real IdP/API/CLI/browser tests prove issues work without creating bare Git storage; Git transport, native PR and mirror writes are refused while normal Git reads still succeed. This is a separate M4 increment from the in-progress app-shell reporting links. Production registration and activation remain gated.




## Native issues — M5 explicit PR relations (September 18, 2026)

`openape-monorepo.worktrees/native-issues-links`, branch `feature/issue-1356-native-issues-links`, base `674de015` (M4 core). Adds reciprocal `Related` links with live access intersection and audited idempotent creation/removal. The actual IdP/CLI fixture successfully merges a real PR through the unchanged exact-SHA endpoint and confirms the linked issue remains open. Signed HTTP denial tests and Vue interaction checks pass. M4 core passed all 17 clean local gates and is pushed at `674de015`; app-shell links and external-code issue homes are still outstanding M4 work. M2 external CI had one unchanged Pods database test timeout; the entire targeted suite passes locally and one exact-source retry is running. Continue through M4/M5 reviews and M6 rehearsal; production cutover remains separately gated.


## Native issues — M4 product reporting (September 18, 2026)

The dependent checkout `openape-monorepo.worktrees/native-issues-reporting`, branch `feature/issue-1356-native-issues-reporting`, starts from M3 source `597de762`. It adds versioned product routing, private report participation, intake-only transfer with explicit label mapping, audited moderation and matching web/CLI flows. The real IdP/CLI suite covers report → transfer → discussion → revocation. Browser checks exercise product preselection through login and responsive reporting. M1 is merged through PR 60 at `048ab8ab`; M2 is in PR 61. Product registration and production intake creation remain disabled until rollout. App-shell links and external-code issue homes follow in a separate M4 increment; continue M5/M6 before requesting the concrete production cutover approval.


## Native issues — M3 UI (September 18, 2026)

The approved UI is implemented in `openape-monorepo.worktrees/native-issues-ui`, branch `feature/issue-1356-native-issues-ui`, based on M2 `039e3ad6`. Repository/overview pages, safe previews, discussions, metadata and stable participant links use the private API. Real IdP-backed CLI/session tests and actual-CSS desktop/mobile browser checks are registered in the shared contract; synthetic screenshots and a portable report are generated under the Git app `.artifacts/issues/`. Continue final gates, native diff review and exact-source merge, then product reporting, explicit PR relations and migration rehearsal. Keep production issue data untouched until the separate M7 approval.

## Native issues — M2 API and CLI (September 18, 2026)

Two exact-source external CI attempts hit the 5-second limit in the unchanged Pods future-database byte assertion. Replace recursive Buffer equality with native `Buffer.equals`, preserving complete byte comparison without per-byte JavaScript traversal; do not increase the timeout or bypass CI.

The dependent checkout `openape-monorepo.worktrees/native-issues-api`, branch `feature/issue-1356-native-issues-api`, starts from reviewed M1 source `c5e12cea`. It adds private issue/comment/label routes, safe Markdown rendering, same-origin cookie mutations, bounded inputs/rates and matching native CLI commands. HTTP tests exercise real H3 handlers, file-backed SQLite and signed SP tokens. Root CLI tests preserve literal body-file contents, retry headers and pre-request validation. Full Nuxt/IdP/CLI and UI verification follow in M3 before enabling the capability. Continue through the approved milestones without a per-milestone session handoff; production migration remains gated.

## Native issues — M1 implementation (September 18, 2026)

Patrick requested end-to-end execution of [the approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2A5ZAT63A04PWGVBT5M14MW), tracked by [issue 1356](https://git.openape.ai/openape-ai/openape/issues/1356). The isolated checkout is `openape-monorepo.worktrees/native-issues`, branch `feature/issue-1356-native-issues`, based on canonical `0f7425539c81950e54882bd851190f58e9011302`. M0 was already merged through PR 50. M1 adds ordered transactional database migrations, private issue storage, live grant-aware visibility and verified exact-scope principals. Ten focused storage tests, all 153 Git app tests and all 105 auth module tests pass; lint, typecheck, Git build and Doctor pass. Initial source `c5e12cea` passed all 15 local gates and all three external checks; the layout retry passed after an unrelated Pods pointer-drag timing failure. Canonical `6c53b6ec` is integrated, preserving the concurrent Pods work; repeat exact-source verification before merging PR 60. Continue through M2–M6 after independently reviewed increments; keep the capability disabled until rollout. Production migration/cutover retains its separate M7 approval.

## Pods guided chat setup and model selection (September 18, 2026)

Owner-approved [plan](../../.claude/plans/2026-09-18-pods-guided-setup.md), [issue 1354](https://git.openape.ai/openape-ai/openape/issues/1354), worktree `pods-conversation`, branch `bugfix/issue-1354-chat-setup`, canonical base `0f7425539c81950e54882bd851190f58e9011302`. Concrete HTTP, directory and application reviews now live in chat; ordinary missing values have answer forms, secret proposals explain acquisition and open the protected alias field. Saved script status and continuation replace the misleading automatic sample. GPT-6 Astra and the bundled GPT-5.6 models are selectable and passed through on creation/resume. The two-minute total deadline is replaced by inactivity and total bounds.

Full lint/typecheck/build, 41 focused unit/component checks and 16 synthetic native cases pass. Inspected screenshots cover prefilled HTTP scope, German narrow dark resolved cards and Astra selection. Tests verify native cancellation, persisted real permissions, exact outbound model IDs, secret isolation and zero fixture runs/enabled schedules. Retain permanent tests for these owner-control and routing contracts. No owner profile mutations or real mail/model/Telegram calls. Next: normal commit/push gate, native PR review and exact-source merge checks, then clean packaging and paired app/profile installation. Preserve the owner-enabled schedule. Final SHA/PR, full gates and installation receipts belong to the local `2026-09-18-chat-setup` report.

## Pods publication completed (September 18, 2026)

Patrick requests committing and pushing the current Pods source to the canonical repository and completing the normal PR workflow. Existing [PR 56](https://repos.openape.ai/patrick/monorepo/pulls/56) will contain the accumulated desktop changes: simpler permissions, directory access, immutable dependencies with npm search, explicit agent tools, bounded application HTTPS, owner selection, execution approvals and readable recovery. Canonical main `59e0de19309cc80cb2e1996057f0f981699ff32d` is integrated without product changes; the only merge conflict was this status index. The IdP code is already identical to main.

Installed source remains `598c0fb3620804081dd189fbf56c581035867335`; no reinstall is needed for this documentation merge. Patrick confirmed successful mail delivery and independently enabled the 15-minute Mail-Kurzbericht schedule. Read-only inspection confirmed an active Pod, enabled interval, successful delivery/no-new-mail runs, no queued recovery and no storage error; the two other Pods remain paused. Do not change the live profile or schedule while publishing code.

PR 56 is merged at `325588d4b795e93a7b8a72d9d6dfaf34bc543d2c`. Reviewed source `bd758f422dc766e812a4abe8f6148a8302fa6227` and target `59e0de19309cc80cb2e1996057f0f981699ff32d` matched the merge request. Full clean local gate `.openape/check-results/1789738786595-bd758f42-all/summary.json` passed, including 236 Pods unit/component and 127 native cases; exact-source CI, E2E and layout all passed externally. Existing native fixtures were updated for the current UI and real signed managed-runtime grant boundary; an asynchronous tab assertion now waits for the rendered Settings panel. All providers in tests are synthetic. Merge, reviewed diff and exact check receipts are in the local `2026-09-18-publication` report. Earlier dated entries below describe prior delivery snapshots and constraints.

## Pods conversational chat layout (September 18, 2026)

Owner-authorized continuation of [issue 1354](https://git.openape.ai/openape-ai/openape/issues/1354), worktree `pods-conversation`, branch `feature/issue-1354-chat-layout`, canonical base `325588d4`. Chat now uses right-aligned user messages, plain assistant replies, a bottom composer with Enter/Shift+Enter and stop controls, and collapsed technical activity/drafts. The original request appears once in the conversation. Access proposals remain reviewable; permissions and runtime execution are unchanged. Full lint/typecheck/build and 12 focused component cases pass. Four packaged cases cover creation, pending/declined access, original-message retention, restart/localization, narrow dark layout, fixed composer geometry and scroll-follow behavior without interrupting reading. Native empty-chat assertions now verify the visible welcome and composer. Bilingual screenshots were inspected and both illustrated handbooks regenerated. Keep the owner's enabled schedule and user data during local delivery. Complete native PR review, exact-source gates, merge, clean packaging and paired app/profile installation; record the final source and evidence in the local `2026-09-18-chat-layout` report.

## Pods run simplification (September 18, 2026)

Local continuation of [issue 1354](https://git.openape.ai/openape-ai/openape/issues/1354) on `pods-conversation`, branch `feature/issue-1354-simple-permissions`, starting at `4464a669514ede130a66b44fe0e9eaec55e86491`. Existing PR 56 predates this local work; Patrick now requests publication of the current desktop source through that PR. The later explicit publication authorization supersedes the previous no-full-E2E constraint. History groups observed operations, shows successful and unfinished counts, and guides stopped runs through inspection before retry. Overview opens recovery instead of queueing another run. Storage inventory counts Codex temporary symlinks without following targets; backup validation remains strict. Handbook JSON now preserves the previously Markdown-only execution-approval guidance.

Full lint (51 tasks), typecheck (72 tasks), app build and 23 focused unit/component checks pass. Permanent regression coverage protects storage inventory/backup boundaries and retry navigation. The single synthetic readable-run native fixture passes; inspected DE/EN and narrow screenshots show grouped success/failure and the next action; no full E2E or live mail/model/Telegram calls are authorized. Exact screenshot, clean package revision, installation and owner-data verification receipts belong to `/Users/patrickhofmann/Companies/private/repos/openape/openape-pods/.claude/reports/2026-09-18-run-simplification/`. Local delivery uses the normal unit commit hook and a paired app/profile rollback; the receipt records the installed clean SHA and final owner-state comparison. At installation, all owner content was preserved and schedules remained disabled; only recalculated storage usage and clearing the diagnosed inventory warning are expected database differences.

## Readable Pods execution and approvals (September 18, 2026)

The approved [implementation plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2SQ8F3QCKHNYHES1BKEET2C) is implemented locally in `pods-conversation`, branch `feature/issue-1354-simple-permissions` (issue [1354](https://git.openape.ai/openape-ai/openape/issues/1354), existing PR 56 remains unpushed). Consumed once grants are renewed, managed execution uses a Pod-scoped shape through the ape-shell authorization library, waiting approvals open automatically with an in-app fallback, and History exposes actual activity and safe recovery guidance. Secrets remain assigned per Pod across validated script changes. The native sandbox remains; external terminals still use ape-shell CLI.

Focused signed-grant, native sandbox, approval timing, recovery and component checks pass. A synthetic local IdP instance renders the actual grant page and verifies a standing rule accepts the next script request. No full E2E, live mail/model/Telegram runs, schedule activation or remote push. The isolated IdP grant page is now merged and deployed through PR 57 / `59e0de19`; see its publication row below. Exact package/installation/profile-preservation receipts are maintained in the planning workspace `.claude/reports/2026-09-18-readable-runs/`. Read those receipts before further delivery. Existing owner records, both real runs and encrypted files must survive installation.

## Pods owner correction (September 18, 2026)

Patrick confirmed his OpenApe owner is `patrick@hofmann.eco`, independently of the `phofmann@delta-mind.at` mailbox. `apes whoami` confirms this. The prior Mail-Kurzbericht setup incorrectly reused the app’s older OpenApe connection, causing both approval POSTs to return 403. A normal browser sign-in connected the correct account without copying shared CLI refresh credentials. Connection selection now preserves an existing Pod owner, uses the newest ready account for new Pods and fails closed on duplicate owner bindings. Two focused regression checks plus translation checks pass. Installed clean `b70736a68ac577d7f474f9f8c08001b5b2ec4b33`; Mail-Kurzbericht alone was rebound, two replacement grants are pending and both superseded grants are revoked. Owner-only server verification returns 200; draft 6 validates synthetically. Other Pods retain their owners and data; o365 state and Telegram ciphertext are unchanged. All three Pods remain paused with zero runs/enabled schedules. No full E2E or push. Receipt/current approval links: /Users/patrickhofmann/Companies/private/repos/openape/openape-pods/.claude/reports/2026-09-18-owner-correction/README.md.

## Pods mail preparation and application networking (September 18, 2026)

Installed clean `e0fe3eb50a9cffd2076b296e75cf547356332478` from `pods-conversation`, issue 1354 / existing PR 56 continuation. Assigned applications expose bounded HTTPS hosts; proxy DNS is pinned to public IPv4. Only network-enabled application processes get macOS trustd access, verified by isolated o365 silent refresh. Full lint/typecheck/build, 29 focused checks and 220 Pods unit checks via the normal hook pass. Mail-Kurzbericht draft 5 is synthetically validated, Telegram identity/destination verified, and the secret encrypted. The two scoped mail/Telegram grants are pending owner approval. All three Pods remain paused with zero runs/schedules. Other-Pod rows are unchanged; the OpenApe owner credential was resaved during enrollment and two encrypted records were added. The script launcher requires a separate ape-shell grant; no broad permanent shell grant is authorized. Code-bound secret approval, a controlled first baseline and new-mail delivery test remain open before enabling the interval. No full E2E/push. [Inspected installed evidence](https://testrun.openape.ai/r/yHh0ISy9oFCSoLAjoEVyHAzZ). Setup/rollback receipt: /Users/patrickhofmann/Companies/private/repos/openape/openape-pods/.claude/reports/2026-09-18-mail-setup/README.md.

## Pods agent tool selection (September 18, 2026)

`pods-conversation`, issue 1354 / existing PR 56 continuation: `context.agent.run` defaults to no tools and accepts explicit `tools: []` or `tools: ["ape_shell"]`. Runtime validation and the creation-chat reference share this contract. Tool-free calls have no MCP configuration/broker and the provider gateway forces an empty tool list. Both handbooks are updated. Full lint/typecheck, app build, seven focused unit checks and three native SDK transport cases pass; the native cases cover default/explicit no-tools with forced calls plus explicit assigned-tool operation. These security-boundary regression tests are retained. Installed from clean bb156ca1c176efce183be226b277dca72665004f. The normal commit hook also passed 217 Pods unit checks; two focused installed-runtime probes passed with synthetic provider responses. Mail-Kurzbericht draft 4 now uses explicit tools: []; all eight encrypted files and all three paused Pods are preserved, with zero runs/enabled schedules. No full E2E, push or merge was performed. Existing network/grant/Telegram readiness gates remain separate. Evidence: /Users/patrickhofmann/Companies/private/repos/openape/openape-pods/.claude/reports/2026-09-18-agent-tools/README.md.


Updated 2026-09-18. This is a handoff index, not an assumption that an old branch
still matches live main. Re-read the plan and Git refs at session start.

| Work | Issue / plan | Checkout | Verified evidence | Next step |
|---|---|---|---|---|
| Readable Pod grant publication | [Issue #1354](https://git.openape.ai/openape-ai/openape/issues/1354), [approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2SQ8F3QCKHNYHES1BKEET2C) | `pods-grant-publication`, `feature/issue-1354-readable-pod-grants`, base `5c48396b` | Four IdP files extracted unchanged from locally installed Pods source `4464a669`; [isolated real IdP and installed UI evidence](https://testrun.openape.ai/r/5Nwcc1z7rKqiRgpSfyyX9tRV). Owner authorized publication on September 18. | Merged via PR 57 at `59e0de19309cc80cb2e1996057f0f981699ff32d`; IdP tested-image deployment and served bundle verified. Desktop publication is tracked above. |
| Pods dependency list and npm search | [Issue #1354](https://git.openape.ai/openape-ai/openape/issues/1354), owner continuation September 17 | `pods-conversation`, `feature/issue-1354-simple-permissions`, base `c897478b` | List with fixed versions, plus/minus, public npm search and npm package URLs; metadata-only bounded main-process requests, explicit preparation unchanged. 16 focused checks, real registry search/link probe, full lint/typecheck and one packaged UI case pass; DE/EN screenshots inspected. | Installed clean `507fe6977`; schema 18, 54 owner tables and seven ciphertexts preserved, two paused Pods, zero runs/schedules. [Evidence](https://testrun.openape.ai/r/bk53PHLgDyE7gpxikOKrZ_x_). Paired rollback 2026-09-17-150655. No push/full E2E. |
| Pods managed script dependencies | [Issue #1354](https://git.openape.ai/openape-ai/openape/issues/1354), [authorized plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2QMBY4KX5MW1X4S225NPE56) | `pods-conversation`, `feature/issue-1354-simple-permissions`, base `3587a2ef` | Exact package declarations, isolated public-registry npm preparation, read-only hashed sets, schema 18, script/credential binding, backups and bilingual editor/chat/handbooks. Targeted unit checks and packaged synthetic execution passed; packaged npm prepared csv-parse 6.1.0. HTTP section gap increased to 36px. | Installed clean `2636e82b`, schema 18; 50 existing tables, stable settings and seven encrypted files preserved, two paused Pods and zero runs/schedules. [Evidence](https://testrun.openape.ai/r/r2nUtVFucRgYWTDBhQXRXu7K). Paired schema-17 rollback retained. Do not push/full-E2E: owner tests manually. No owner mail, secrets, messages or schedules used. |
| Pods simple permissions and directories | [Issue #1354](https://git.openape.ai/openape-ai/openape/issues/1354), owner UI correction September 17 | `pods-conversation`, `feature/issue-1354-simple-permissions`, previous local install `d5033491` | HOME/workspace rows plus native folder assignment with read/read-write selectors and revocation. Schema 17 preserves resource rows; script and broker sandboxes consume explicit directory permissions. Targeted UI/storage/backup tests, native RO/RW/symlink probe and one packaged UI/script case pass; inspected DE/EN screenshots including narrow dark layout. | Installed clean `15d9115c`; schema 17 startup preserves owner content and encrypted state. [Evidence](https://testrun.openape.ai/r/eZImUaZDvgO3iFTwHVSIUhJb). Paired schema-16 rollback retained. PR 56 source `95b34767` predates these local changes. Owner explicitly takes over full E2E: do not trigger full CI by pushing. External owner terminal/GUI remains Mac-user/ape-shell scoped, not directory-sandboxed. |
| Pods installed applications | [Issue #1354](https://git.openape.ai/openape-ai/openape/issues/1354), [authorized continuation](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2Q8V14XWHSF894NFQF9CFA1) | `pods-conversation`, `feature/issue-1354-installed-applications`, base `82f16e0e` | Production o365 build removed; installed application picker and no-argument Play under the existing owner ape-shell boundary. List follows the owner's macOS screenshot. 15 focused unit checks and 7 packaged/native checks pass, including signed grant allow/deny, no-argument AppKit startup, private setup persistence and absence of bundled o365. DE/EN list screenshots inspected. | Verify, review, package and install with paired rollback. Preserve owner pods and credentials. No live mail/messages/schedules. GUI HOME is not proof of application account isolation. |
| Pods external ape-shell | [Issue #1354](https://git.openape.ai/openape-ai/openape/issues/1354), [authorized plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2M9YDS92G8GA3T84KQDPBKY) | `pods-conversation`, branch `bugfix/issue-1354-terminal-start-feedback`, base `5179cda7` | PR 53 installed with paired rollback and preserved owner data. Owner terminal click exposed missing production Pod enrollment route (404); tested IdP `5179cda7` deployed with health gate and previous tag `3f07d0db`. Unauthenticated enrollment now correctly returns 401. | Review/ship direct launch progress and inline failure feedback; owner native Terminal.app confirmation remains manual because computer-use tooling excludes it. Bundled o365-cli is historical prototype scope; future tool assignments should use owner-installed executables with preserved program state. No owner task, mail, model, Telegram or schedule activation. |
| Native issues M0 | [Issue #1356](https://git.openape.ai/openape-ai/openape/issues/1356), [approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2A5ZAT63A04PWGVBT5M14MW) | `openape-monorepo.worktrees/native-issues-m0`, branch `feature/issue-1356-native-issues-m0`, base `08b1eaae3f9a129ee4b3c7563ba3803030bed43e` | [Inventory and disposable rehearsal](../operations/native-issues-migration.md): 230 issues, 175 comments, 993 timeline records; issue writes blocked while branch/main pushes and actual Actions succeed. Eight inventory tests, full lint/typecheck and Doctor pass. All 15 local CI steps pass at `.openape/check-results/1789473266340-08b1eaae-all/summary.json`, including 110 Pods native tests. Use `DEVELOPER_DIR=/Library/Developer/CommandLineTools`; default Xcode selection fails on its unaccepted license. | Review the native PR and exact-source checks. M1 starts with repository authorization/storage. Actor mapping, attachment integrity, independent owners, full freeze coverage and legacy-login fragment continuation remain migration gates. No native issue feature or production import in this increment. |
| Pods creation chat and description | [Issue #1354](https://git.openape.ai/openape-ai/openape/issues/1354), [PR 46](https://repos.openape.ai/patrick/monorepo/pulls/46), [PR 47](https://repos.openape.ai/patrick/monorepo/pulls/47) | Delivered from clean merged `e18fcc17` | Exact start request and 32 owner chat entries recovered; real 536-character description and full installed restart verified. 178 unit/component and 108 native tests passed. | [Installed evidence](https://testrun.openape.ai/r/5kVqVmILpHA-rUKzSTj2FYFt). Subsequent approved script-authority change below supersedes the separate execution assignment. |
| Pods script authority | [PR 48](https://repos.openape.ai/patrick/monorepo/pulls/48) | Installed clean `08b1eaae` | Schema 16, name-only metadata, preserved execution bindings and owner migration/restart pass. | [Installed evidence](https://testrun.openape.ai/r/0W4ODmIkT0Qbdym36HZOzwHU). Mail-Alarm remains paused with setup pending. |
| Pods variables and secrets | [PR 49](https://repos.openape.ai/patrick/monorepo/pulls/49) | Installed clean `2217269d` | Seven-tab UI, explicit empty values and required secrets; full gate, external checks, DMG and unchanged owner restart verified. Telegram destination later saved through the owner UI. | [Installed evidence](https://testrun.openape.ai/r/VS80JHNHl6-ZLyttVgSjCRqf). Application setup remains pending. |
| Pods command terminal | [Issue #1354](https://git.openape.ai/openape-ai/openape/issues/1354), [plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2JRW66M2CQEC9SE2448BA8E) | `pods-conversation`, `feature/issue-1354-pod-command-terminal`, base `1ba85c7e` | Replaces argument form with full-command prompt, assigned-app resolution and actual pod workspace cwd; private application HOME/cache persists. Focused component and packaged native tests pass, including denied outside read and setup-to-script reuse. | Delivered through PR 52 at `fc50c7e2`; superseded by the external ape-shell continuation above. Foreground script broker retains fork denial; no live provider calls. |
| Pods application actions | [PR 51](https://repos.openape.ai/patrick/monorepo/pulls/51) | Delivered from clean merged `1ba85c7e` | Application name dispatch, access controls and owner draft migration verified. | The command terminal continuation above replaces its arguments panel. |
| Pods prompt-driven setup | [Issue #1354](https://git.openape.ai/openape-ai/openape/issues/1354), [approved implementation plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2HN7WGNBBDWVEC0ETEQN9J4) | `openape-monorepo.worktrees/pods-usability`, branch `feature/issue-1354-prompt-setup`, base `f41487a3` (merged PR 44) | Generic application/terminal/HTTP work is merged and packaged. This follow-up adds chat configuration, runtime guidance, selected-pod action scope and Settings links for secret proposals. 166 unit/component tests and 11 targeted native/packaged tests passed during development, including one visible prompt, validation repair and a manual file/checkpoint run with a recorded model. | Complete full gates, review/merge and prepare the new package. PR 45 also verifies that chat inspection reads the same saved working source as the editor, including manual edits. Patrick explicitly deferred owner installation on September 15. No owner profile, provider credentials, live mail, Telegram delivery or owner schedules are touched. Live model quality remains separate acceptance. |
| Pods simplified workspace | [Issue #1355](https://git.openape.ai/openape-ai/openape/issues/1355), [PR 43](https://repos.openape.ai/patrick/monorepo/pulls/43), [approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2G2D2ZVE00RPKRVBF7PTB7E) | Merged at `70b7a410`; the preserved `pods-usability` worktree now hosts the issue-1354 continuation above | Six tabs, per-pod chat, highlighted editor, Settings values, resizable sidebar and schema-13 migration. 140 unit/component and 93 native/Electron tests pass, including real macOS safeStorage. Full local and exact-source external gates passed. Both illustrated manuals, clean merged distribution and paired app/profile delivery are verified. | Owner feedback identifies remaining legacy mail-specific permissions and onboarding; track correction under issue 1354. Installed owner app/profile remain unchanged during the new synthetic tests. |
| Pods programs and icon | [Issue #1354](https://git.openape.ai/openape-ai/openape/issues/1354), [approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2FVCAY9N2S7KFEHXHBV6QMB) | `openape-monorepo.worktrees/pods-programs`, branch `feature/issue-1354-pods-programs-terminal`, base `37c2a454` | Custom macOS icon packaged and byte-verified. [G0 probes](../../apps/openape-pods/experiments/programs/README.md) prove PTY basics and a detached-child lifetime failure when fork is enabled; production policy is unchanged. | General shell/GUI execution remains blocked by G0. Review a revised lifetime mechanism or explicitly narrower foreground-CLI scope. Deliver the icon independently after exact-source gates. Preserve the paused owner pod and all account connections. |
| Pods direct script credentials | [Issue #1353](https://git.openape.ai/openape-ai/openape/issues/1353), [PR 41](https://repos.openape.ai/patrick/monorepo/pulls/41) | `openape-monorepo.worktrees/pods-implementation`, source `0cda0d69` | Real macOS safeStorage acceptance passes with real HOME and asserted isolated userData/sessionData. Full clean 15-step gate, 128 unit/component and 91 native/Electron cases pass at `.openape/check-results/1789386985801-0cda0d69-all/summary.json`. | Merged through PR 41 at `e56c3972` after all exact-source CI/E2E/layout gates; include schema-12 migration backup in the refreshed icon delivery. Earlier keychain failure reports are historical; no synthetic cipher substitutes for this successful default test. |
| Pods German/English | [Issue #1352](https://git.openape.ai/openape-ai/openape/issues/1352), [plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2DTN55XMA45JTFADRDRVN9Q) | `openape-monorepo.worktrees/pods-implementation`, branch `feature/issue-1352-pods-localization`, base `959aa468` | Persisted language switcher, renderer/native localization and two illustrated handbooks. Packaged switching, retained source, restart and native menu/dialog checks pass. Full evidence is maintained in the plan. | Complete exact-source native PR review and required CI/E2E/layout gates; no live account/provider access, owner schedules or signed release. |
| Pods sidebar groups | [Issue #1351](https://git.openape.ai/openape-ai/openape/issues/1351), [plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2DR8FJBBJ3PKFW25FH0EX71) | `openape-monorepo.worktrees/pods-implementation`, branch `feature/issue-1351-pods-groups` | Persistent flat groups, collapse, move and remove while retaining pods; schema 11 separates organization from assignment revisions. 111 unit/component cases pass, including migration, grouped backup/restore and stale open-form conflicts. | Packaged UI flow and all 84 native cases pass; handbook has 16 chapters and 10 inspected images. Full 15-step gate is recorded in the feature plan. Native PR review and exact-source external checks precede integration. Existing live-service and signed-release gates remain open. |
| Pods implementation / release acceptance | [Issue #1349](https://git.openape.ai/openape-ai/openape/issues/1349), [approved continuous implementation plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2A2ZV0AAPDW75YMD4TVG8Q5) | `openape-monorepo.worktrees/pods-implementation`, branch `feature/issue-1349-pods-implementation` | M1–M11 merged through PR 36 (`b5a4ccac`). M12 code source `ce6edb7709563cd2812c2a3ce16c53a95fd6878a` is reviewed in [PR 37](https://repos.openape.ai/patrick/monorepo/pulls/37), with 97 unit/component and 82 native/Electron passing tests; full clean 15-step gate `.openape/check-results/1789310426429-ce6edb77-all/summary.json` passed. [M12 evidence](https://testrun.openape.ai/r/Ro7zOvnpRye6WfuW1t8a-c_s) includes four inspected screenshots and actual read-only DMG execution. | PR 37 is the final implementation increment; consult its live merge/check state. After integration, only the separately authorized release acceptance remains: real authentication/provider/tenant refresh, physical sleep/wake, authoritative native license notices, signing/notarization/Gatekeeper and clean-machine OS/CPU acceptance remain release gates. Current execution pilot: Darwin 25.6.0 arm64 only. No live mail, real identities/provider credentials, owner schedules or release publication. |
| Pods M1 desktop foundation (merged PR 25) | [Issue #1348](https://git.openape.ai/openape-ai/openape/issues/1348), [approved M0 / M1 plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2A2ZV0AAPDW75YMD4TVG8Q5) | `openape-monorepo.worktrees/pods-foundation`, branch `feature/issue-1348-pods-foundation`, canonical base `db8d87cd`, audit prerequisite `21d80190` | [App scope and verification](../../apps/openape-pods/README.md); 7 unit/component tests and 4 actual Electron tests pass; complete 15-step unit/E2E/layout contract passed locally in `.openape/check-results/1789280749417-21d80190-all/summary.json` before commit. | Merged after all exact-source checks passed; canonical merge `82cc47a5`. Continue in issue 1349. |
| Production dependency audit | [Issue #1347](https://git.openape.ai/openape-ai/openape/issues/1347) | `openape-monorepo.worktrees/audit-dependencies`, branch `bugfix/issue-1347-audit-dependencies`, base `db8d87cdbf67f6ac497a84004edebddc2f624240` | [Repair and evidence](../operations/dependency-audit-1347.md): audit high/critical reduced to zero; full forced lint/typecheck, 48-task build and complete CI passed (`1789196274249-db8d87cd-all`). | Merged via native PR 23, canonical merge `95bae482`. No deployment or publication. |
| Unified Node and cli-auth release | [Issue #1344](https://git.openape.ai/openape-ai/openape/issues/1344) | `openape-monorepo.worktrees/ai-workflow`, branch `fix/issue-1344-node-toolchain`, base `eeeaa763` | Node 24.15.0 pinned in `.nvmrc`, local activation and CI share the pin; cli-auth 0.5.5 is a scoped Changesets patch. | Read the issue for exact PR/check/merge/publication evidence. Publish only cli-auth via the explicit release filter from clean canonical main; npm authentication must succeed. |
| Restricted-session toolchain | [Issue #1343](https://git.openape.ai/openape-ai/openape/issues/1343) | `openape-monorepo.worktrees/ai-workflow`, branch `fix/issue-1343-session-toolchain`, base `4914bb03` | pnpm launcher/cache failure reproduced with network and cache writes denied; direct pinned pnpm runs the project Doctor and dry-run. [Setup and evidence](../operations/session-toolchain.md). | Read the issue for PR and exact check/merge evidence; follow the toolchain setup in new restricted sessions. |
| AI workflow rollout | [Issue #1342](https://git.openape.ai/openape-ai/openape/issues/1342), [live approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M1X6QVHZ5HXR11C7T0SVW206) | `openape-monorepo.worktrees/ai-workflow`; final acceptance is a separate fresh clone `/tmp/openape-workflow-fresh`, branch `fix/issue-1342-local-startup` | Checkpoint `a4921e2f` (PR #19); M0–M6 complete. Sources/check runs in [rollout evidence](../operations/ai-workflow.md). New Tasks/ape-pr dev ports started successfully with isolated data. | Read the live plan for final PR, exact checks/merge and independent session outcome. If it is done, no rollout work remains; select a new task explicitly. |
| Existing CRM work | existing `feature/crm-variante-b` branch | original `openape-monorepo` checkout | Initial inspected HEAD `ea2ebc16`; unrelated untracked work preserved. | Resume only for an explicitly selected CRM task. |
| LLM pull queue specification | existing `spec/llm-pull-queue` branch | `openape-llm-pull-queue` linked checkout | Initial inspected HEAD `f740d0f0`; same Git repository, not another product repo. | Read its own diff and issue before continuing. |

Other registered worktrees are intentionally not labelled abandoned. Use
`git worktree list --porcelain` and inspect their status before deciding whether
to resume or remove them. Do not delete a worktree on the strength of this index.

At handoff, record the actual branch and SHA, PR URL, exact successful/failed
checks and their log paths, remaining blockers and the next concrete action.

## Native issue production pilot — September 20, 2026

Patrick approved the concrete M7 pilot in the existing plan. Work starts at
canonical main `934dbcec21cce8e3620ecda51a77aa8458bcfd30` in
`native-issues-cutover`, branch `feature/issue-1356-native-issues-cutover`.
The preflight source now contains 233 issues, 175 comments and three assets;
three new Pods issues explain the change since rehearsal. Nineteen assignments
remain unverified. Source restrictions/dependencies/projects/reactions/time
entries remain absent in the scoped database census. An off-site native-registry
backup completed before preparation. Production issue writes remain on Forgejo
until the frozen manifest passes reconciliation and the native lock is released.

This increment prepares reviewed source SQL and gateway service configuration.
The same SQL generator now passes the disposable real Forgejo Git/Actions proof
and an explicit removal/rollback check. Production operations, exact source/target
hashes, native activation and seven-day observation will be recorded in the
synchronized plan and restricted operator receipts. No issue authority changes
are implied by merging this preparation increment.
