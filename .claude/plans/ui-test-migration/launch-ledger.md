# Parallel UI verification launch ledger

## Authority and baseline

Patrick approved proposal revision 1 on October 15, 2026 and explicitly requested
three separate sessions/worktrees, coordination messages and merges. Approval is
recorded verbatim in `plan.json`. Troop and its extraction worktree are excluded.
Preparation starts at `7d0caa8b67a939284d008761efe977dc76fbe288`; the preparation
merge SHA is **95d1083abfb9de07ad8edf5bb16c71e06207c5fd** (PR 435). All three
worktrees started there with independent frozen installs and successful doctor checks.

## Shared preparation and manifest agreement

- Git and Inbox receive the existing catalog `@vitest/browser` and
  `@vitest/browser-playwright` dev dependencies. Reports already declares both.
  No new version resolution or framework; all existing assertions remain.
- Git owns its existing `test:layout` configuration and may change that config
  to browser-component acceptance only after replacement proof. Preserve a named
  real integration path in its existing E2E suite.
- Inbox may add `test:layout: vitest run --config vitest.browser.config.ts` together
  with its working config. The coordinator will regenerate architecture metadata
  and add the manual layout contract entry before its final gate/merge.
- Reports retains its existing `test:layout` command and improves its CSS setup.
- No other dependency or script changes are pre-approved. Report specific needs
  to the coordinator before touching shared metadata. No shared UI abstraction.

## Exclusive ownership

| Area | Editable app | Dev / HMR ports | Issue / chat / worktree |
| --- | --- | --- | --- |
| Git/Issues | `apps/openape-git/**` | 5481 / 5491 | Issue [1484](https://repos.openape.ai/patrick/monorepo/issues/1484); chat `01a13ec7-11c2-7a11-a9c5-964dbccf643e`; `ui-tests-git` |
| Inbox/PWA | `apps/openape-pods-relay/**` | 5482 / 5492 | Issue [1485](https://repos.openape.ai/patrick/monorepo/issues/1485); chat `01a13ec7-18a0-73b2-a56c-92878d030305`; `ui-tests-inbox` |
| Reports | `apps/openape-testrun/**` | 5483 / 5493 | Issue [1486](https://repos.openape.ai/patrick/monorepo/issues/1486); chat `01a13ec7-20e6-79f0-9b61-f49e60ffcf73`; `ui-tests-reports` |

Coordinator owns root manifests/lockfile, shared check scripts/configuration,
generated architecture documents, active-work documentation and Plan sources.
Each area owns its handoff in its app documentation. Separate installs, generated
outputs, test homes/databases and browser profiles are mandatory. Package download
caches may be shared. Fail on port conflicts; never kill another session's process.

## Heavy-check slot

One slot for cold builds, full affected gates and real integrated acceptance.
Focused browser/unit checks may run concurrently with a small explicit worker cap.
Repository gate environment: `TURBO_ENV_MODE=loose VITEST_MAX_WORKERS=1`.

| Holder | Worktree | Command | State |
| --- | --- | --- | --- |
| Coordinator | `ui-test-plan-1481` | Preparation pre-push gate and all three isolated installs | Released; passed |
| Git/Issues | `ui-tests-git` | First coherent baseline/prebuild/integration batch | Released: setup timeout after 301.46 s; missing grants dist, five tests skipped, processes stopped |
| Reports | `ui-tests-reports` | Unchanged focused layout baseline | Released: 13/13 tests; warm 1.44 s Vitest / 2.05 s CLI; no processes left |
| Inbox/PWA | `ui-tests-inbox` | Dependency builds and real baseline/acceptance | Released: 12 prerequisite builds and 48 tests passed; IdP baseline setup timeout, no test executed |

Request the slot in session commentary; the parent monitors it and sends explicit
grants. A request is not a grant. Do independent implementation meanwhile. The
coordinator alone messages children unless Patrick directly authorizes replies.
Release the slot in commentary with exact commands, results and remaining processes.

## Integration

Open native PRs and explicit issue relations; do not merge from area sessions.
Return source/base SHAs, assertion map, retained boundaries, exact verification,
inspected screenshot/Test Run URL, limitations and process/port cleanup status.
Coordinator reviews exact source/target SHAs, obtains independent review, merges
sequentially and closes technical issues explicitly. CI remains paused. No deploy.

## Preparation evidence and limitations

- PR 435 merged source `a4aa9b5a974e34c8bc1f35333225100d4c3bfd78` against
  `b052e9e50d0548d8ce4acbe4fa1c1b3b53fbddd4`. All 52-workspace local unit
  contract stages passed. No required external gate was configured.
- Private Test Run: https://report.openape.ai/d/01M4ZC8HPP5JDNTA5EFK2BMPVA?v=1
- Additional Claude Opus 5.5 review could not start because its OAuth session
  expired; no independent result is claimed. Primary review completed.
- Other unrelated checkouts also run checks on this Mac. Observe machine activity
  before timing comparisons; our slot controls these three sessions only.

Git requests a later serial prerequisite build and repaired baseline. The failed
initial setup is not a valid performance baseline.

## Actual launch locations

All worktrees are under `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo.worktrees/`.
Branches: `feature/issue-1484-ui-tests-git`, `feature/issue-1485-ui-tests-inbox`,
`feature/issue-1486-ui-tests-reports`. The app collection is not a Git project, so
these are real manually-created Git worktrees assigned explicitly in each chat.
Vitest browser/API ports must also use the reserved area port with strictPort;
setting only Vite server.port is insufficient if the runner overrides it.

Queue after the coordinator fixture repair: Git repaired baseline/prebuild/integration,
Inbox real acceptance, then Reports build/integration. Final push slots follow readiness.

## Shared fixture correction during integration

The coordinator found that `startServer` derived HMR as app port + 10,000,
producing 72,572 for Inbox's 62,572 listener. A regression using a real high
application port reproduced an invalid 70,000 HMR port before the change. The
helper now asks the OS for a separate available port instead of adding an offset.
All nine existing/extended lifecycle tests and focused lint pass. Real IdP
readiness is verified separately; failed area setup attempts remain distinct from
successful performance measurements. This is shared test infrastructure, not a
product/authentication change. Area sessions must merge the reviewed shared fix
before further real acceptance; their original frozen baseline remains recorded.

Coordinator holds the heavy slot for the fixture correction and its normal push
gate. Area browser work remains independent.
