# AI workflow rollout

Plan: https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M1X6QVHZ5HXR11C7T0SVW206
Issue: https://git.openape.ai/openape-ai/openape/issues/1342

## Baseline — 2026-09-07

- Canonical main: `ad8abf67`; Forgejo main: `066dedd5` (41 commits behind).
- Live forge and CI image: `prod-15d331a8` (2026-08-29), before mirror support.
  The live database has no mirror tables; the mirrors endpoint returns 404.
- Forgejo already whitelists the dedicated `ape-git-mirror` identity for main pushes.
- Monorepo webhook `http://ci:8080/hook` responds 202; no `.ape-ci.sh` means no checks run.
- Backup succeeded 2026-09-07 03:17 UTC, snapshot `e2c9b0c7`.
- 53 worktrees before this rollout, none with tracked changes. Untracked work is retained.
- New worktree: `openape-monorepo.worktrees/ai-workflow`, branch `chore/issue-1342-ai-workflow`.
- Existing checkout stays on its CRM branch. Remote origin now denotes ape-git;
  the old origin is named forgejo. Active branch upstreams were migrated without
  changing any local branch tips. Historical inactive branches can still track forgejo.

## Repository identity

`.openape/repository.json` defines the complete canonical URL, default branch,
issue URL and mirrors. `pnpm repo:status` reports the resolved local remote.
Missing or ambiguous identity is an error, never a reason to use a mirror.
Normal development pushes belong on the canonical repository. Mirrors are written
by the server's dedicated mirror identity.

## Version publication

Run `pnpm version-packages` on a feature branch and merge the version PR first.
From a clean main checkout identical to canonical main, use
`pnpm release:local --dry-run`, then `pnpm release:local` to publish. This command
never commits or pushes. Deploy previews can be inspected without network mutations
with `pnpm deploy:image git --dry-run`.

## Completed rollout evidence

- M1: native PR #14, canonical merge `d2cf5378`; full 157-task local gate.
- M2: native PRs #15 and #16, deployed `e03a5ed5`; 125 forge tests.
  The runtime image now includes CA certificates for verified HTTPS mirrors.
- Isolated acceptance repo: `patrick/ai-workflow-validation` on ape-git and
  `openape-ai/ai-workflow-validation` on Forgejo. Native PR #1 merged as
  `44a8faf76aa5349e5b36d5661bf625cf5b220fb3`; source/target match.
  Branch, annotated tag, web merge, tag deletion and branch deletion verified.
  A failed HTTPS attempt recovered after deployment without a new push.
- Empty mirror destinations must use the intended default branch (`main`);
  Forgejo can select whichever branch is pushed first. Default branches cannot
  be deleted there. Configure the destination before validating branch deletion.
- Monorepo mirror: dedicated `ape-git-mirror` identity with repository write
  scope. The previously lagging Forgejo main matches canonical `e03a5ed5`.
- Observe: native repo settings or `GET /api/repos/patrick/monorepo/mirrors`.
  Owner-triggered retry: `POST /api/repos/patrick/monorepo/mirrors/reconcile`.
  Automatic scans run after startup and every five minutes. Deletion requires
  the target to equal the last successful replicated SHA; unknown/diverged refs
  survive. Updates never force an alternative history over the destination.

- M3: PR #17, source `dbaea29a`, external CI/E2E/layout runs 4323/4324/4325;
  merge `e5cf0d1a`. Local and external jobs use the same check contract.
- M4: PR #18, source `bdfa60c7`, external runs 4329/4330/4331;
  merge/deployment `3f52d59a`. Main requires the exact source's three Forgejo
  contexts. Direct, force and deletion pushes are denied even for the owner.
  Policy changes require the human owner and an audit reason.
- Isolated protected PR #2: missing, pending, failed and stale check evidence
  and stale reviewed heads were refused with HTTP 409. After the independent
  green run on `c0cd4e26`, the native CLI merged it as `742333ae`; both forges
  matched. [Acceptance PR](https://repos.openape.ai/patrick/ai-workflow-validation/pulls/2).
- M5/M6: PR #19, source `52579f61`, external runs 4338/4339/4340;
  merge `a4921e2f`. Shared AGENTS, a checked 50-workspace map, native JSON CLI,
  read-only doctor and compatible legacy authentication caches are on main.
- M7 checkpoint: a fresh shallow clone from the canonical server installed
  frozen dependencies and built consumed workspaces. Tasks started before the
  fix on 3004. After correction, Tasks on 3005 and ape-pr on 3014 each returned
  `{"ok":true}` from `/api/health` and HTTP 200 from `/`, using separate temporary
  databases and generated session secrets. Processes were stopped afterward.
  The doctor detected both original port collisions and the absent stack;
  after correction it finds no explicit dev-port collision and includes the
  selected app when checking actual Compose services.

Final M7 PR, source/check URLs, merge/mirror SHAs and the independent follow-up
session are recorded in the live plan linked above. That tracker decides whether
acceptance is complete; this file records the reproducible checkpoint without
pretending its own future commit SHA is already known. Initial bootstrap results
remain labelled local; later external results are linked to their exact source.
