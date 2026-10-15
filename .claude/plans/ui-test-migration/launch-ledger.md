# Parallel UI verification launch ledger

## Authority and baseline

Patrick approved proposal revision 1 on October 15, 2026 and explicitly requested
three separate sessions/worktrees, coordination messages and merges. Approval is
recorded verbatim in `plan.json`. Troop and its extraction worktree are excluded.
Preparation starts at `7d0caa8b67a939284d008761efe977dc76fbe288`; the preparation
merge SHA will be the common frozen baseline recorded in the PR receipt and here.

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
| Git/Issues | `apps/openape-git/**` | 5481 / 5491 | Issue [1484](https://repos.openape.ai/patrick/monorepo/issues/1484); chat/worktree after merge |
| Inbox/PWA | `apps/openape-pods-relay/**` | 5482 / 5492 | Issue [1485](https://repos.openape.ai/patrick/monorepo/issues/1485); chat/worktree after merge |
| Reports | `apps/openape-testrun/**` | 5483 / 5493 | Issue [1486](https://repos.openape.ai/patrick/monorepo/issues/1486); chat/worktree after merge |

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
| Coordinator | `ui-test-plan-1481` | Normal pre-push affected unit gate for preparation | Reserved |

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
