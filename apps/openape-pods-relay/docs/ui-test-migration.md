# Inbox UI verification migration

Issue: https://repos.openape.ai/patrick/monorepo/issues/1485

Frozen source: `95d1083abfb9de07ad8edf5bb16c71e06207c5fd`.
Scope: `apps/openape-pods-relay` only, approved UI migration revision 1.

## Test boundaries and commands

Activate the repository Node/pnpm toolchain and run `pnpm run doctor` in each shell.

- `pnpm --filter @openape-pods-relay/app test:layout`: real Vue pages, InboxShell,
  InboxList, InboxDecision, InboxTags and settings in installed Chromium. Vue's
  normal SFC plugin loads their production scoped/global CSS. The relay has no
  Tailwind stylesheet pipeline. Both light and dark media preferences are real
  browser contexts; narrow/wide viewports and large text are measured.
- The fixture uses the production `createInbox` client, deterministic HTTP replies,
  an explicit undo-clock boundary and disposable browser contexts. Nuxt navigation
  and head/config APIs are adapters. Service-worker registration is disabled at
  the OS boundary. No live backend, IdP, Electron, real identity or persisted HOME
  is involved. This proves UI/request behavior, not server authorization or effects.
- `pnpm --filter @openape-pods-relay/app exec vitest run --config vitest.e2e.config.ts e2e/inbox-app.test.ts --maxWorkers 1`:
  built relay plus real fixture IdP, signed desktop API requests and real browser
  service worker. Acquire the coordinated heavy slot first; this command includes
  build/startup. Dependencies must be built serially in this worktree.
- Existing `test/inbox-{list,decision,item,client,worker}.test.ts` stay intact.
  Client tests retain the real SQLite InboxStore; worker tests retain cache and
  account separation contracts. Server/session/receipt/store tests remain intact.

Browser runner ports are 5482 (strict; collisions fail) and 5492 (HMR). Screenshots
are in app-local `.artifacts/layout`; `PODS_INBOX_SCREENSHOTS` overrides the path.
Each run owns a fresh Playwright browser context, no persistent browser profile.
Unmount clears shell timers/listeners; fixtures are recreated per test. The real
E2E harness owns temporary databases, IdP data and browser storage states.

## Assertion inventory and replacement mapping

Original source: `e2e/inbox-app.test.ts`, single integrated scenario. Unit tests
already cover logical presentation; they do not calculate CSS geometry.

| Original assertion / observable contract | Browser replacement in `test/layout/inbox.test.ts` | Counter-proof | Retained real boundary |
| --- | --- | --- | --- |
| Mail sender promoted; raw metadata omitted | `presents sender, classification and tags…` | Remove sender, classification hints; expose raw body | Signed publication and real change-feed delivery |
| Decision detail Pod tags | `requires evidence and renders pending…` | Hide InboxTags | Actual decision request and receipt application |
| Message detail tags at 390/1280, light/dark | `shows detail tags and safe external links…` | Hide tags | Real message opening/read persistence; external-link safety |
| No horizontal overflow on cards/details | `presents sender…`, `shows detail tags…` | Force 900px shell width | Built app navigation, offline/reconnect |
| Cards stay in place through pending/accepted and fresh arrivals | `keeps cards fixed through undo…` | Put status cover in normal flow | Undo sends no command; accepted answer claims the correct desktop operation; fresh feed appears |
| Settings large-text values remain readable | `keeps settings values and navigation readable…` | Force 80px value width | Reinstall, device revocation, account switch and language persistence |
| Evidence-required form and pending/accepted/applied wording | `requires evidence and renders pending…` | Remove empty-input guard; mislabel receipt | Kept in E2E where receipt/application semantics cross real services |
| Empty/loading/error and retry | `renders loading, empty and service errors…` | Additional UI coverage; no removed assertion | Empty second-account view remains a privacy check in E2E |
| Actual theme and control sizing | `presents sender…` | Replace dark card token with white | Does not claim native iOS/Safari rendering |

Retain all real authentication redirects, private/no-store badge API and anonymous
401, real worker registration/update/waiting/activation/cache cleanup, offline
reload and disabled decisions, reconnect, restart/reinstall, cross-account cache
purge, revocation, durable read state, exact decision digest/input/option receipt
and synthetic-desktop application semantics.

## Baseline finding

The frozen integrated scenario uses `type: effect` for a freely answerable
business decision. Current `needsRepair()` deliberately renders `work`, `effect`
and Pods `approval` as a repair prompt. Existing repair tests assert this behavior.
The scenario must use a supported business-question fixture for its evidence and
receipt journey; product semantics remain unchanged. The original baseline and
any corrected-fixture measurement must be distinguished. No speedup is claimed
from a failing baseline or fewer assertions.

## Evidence and handoff

Verification, measurements, inspected image digests, exact source SHA and private
Test Run publication are recorded here after acceptance. No CI reactivation or
deployment. Additional Opus review is coordinated centrally and is not claimed.

### Large-text navigation correction

The initial 390px / 28px-font settings screenshot preserved the old value-width
criterion but exposed overlapping fixed bottom-tab labels. The approved app-local
correction lets labels wrap and scales content/update-banner clearance with text.
The browser regression measures each rendered text line inside its own link,
checks navigation height against bottom padding, and scrolls the final content
above the fixed navigation. Removing wrapping or reducing clearance makes this
regression fail; restored light/dark tests pass. Native Safari Dynamic Type is
outside this Chromium acceptance.

### Original baseline limitation

The original E2E command exited 1 after 307.745 seconds, including relay build:
IdP readiness timed out at port 62572, and the scenario was skipped. The shared
harness configured HMR port 72572 (`port + 10000`), outside the TCP range; its
captured log only reported an HMR deprecation. A causal recovery still needs
real acceptance after the coordinator's shared fixture correction. This failed
baseline is not a speedup denominator.
