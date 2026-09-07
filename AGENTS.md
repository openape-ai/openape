# OpenApe monorepo

Start here in every new checkout. This file governs this Git repository;
sibling repositories and linked worktrees have their own checkout state.

## Locate the work

- Source of truth: `.openape/repository.json`. Code, pushes and PRs belong to
  `https://repos.openape.ai/patrick/monorepo.git`. Forgejo and GitHub are mirrors.
- Issues remain at `https://git.openape.ai/openape-ai/openape/issues`.
  Always link the full issue URL across forges; a bare `Closes #N` is ambiguous.
- Run `git status --short` and `git branch --show-current`. In each tool shell,
  run `. ./scripts/activate-node.sh` from the checkout before `pnpm run doctor`.
  Use the explicit `run`: `pnpm doctor` is pnpm's own command. For restricted
  sessions, prepare the [local toolchain](docs/operations/session-toolchain.md)
  before running package scripts; a version-manager download is not a repo test.
  [Native CLI and diagnosis](docs/operations/native-cli.md) cover PRs, checks, logs
  and merge commands. `pnpm repo:status` prints the canonical repository identity.
  Preserve existing tracked and untracked work. Never switch another worktree's
  branch or clean it to make a task easier.
- Use an issue and a feature branch `<type>/issue-<number>-<description>` from
  canonical main. All changes, including configuration, go through a native PR.
- [Workspace map](docs/architecture/workspace-map.md): package names, paths,
  purpose and actual scripts. [Dependency graph](docs/architecture/dependency-graph.md)
  identifies consumers. Prefer scoped `rg` searches in the selected checkout;
  `.worktrees`, sibling `*.worktrees`, archives and generated output are not
  source search roots.

## Build and verify

Use Node from `.nvmrc` and the pinned pnpm version from `package.json`.
The Node engine minimum describes compatibility; `.nvmrc` fixes development/CI.
`pnpm install --frozen-lockfile` installs without re-resolving versions. Preserve
supply-chain quarantine and targeted overrides in `pnpm-workspace.yaml`.

- During development: `pnpm check:affected --base origin/main --head HEAD`.
- Complete merge gate: `pnpm check:ci`. The unit, E2E and layout suites together
  form the required contract. A missing/skipped suite is not a green merge gate.
- `--dry-run` explains scope; `.openape/check-results/` holds complete logs and
  summaries. See [checks](docs/operations/checks.md). Do not bypass a failed gate.
- Before committing or deploying, full `pnpm lint` and `pnpm typecheck` must
  pass. For app changes also build that app and exercise its relevant tests.
- Build consumed workspaces serially before checks; the shared script does this.
  Avoid concurrent fresh declaration builds during typechecks.
- Visible Vue state and interactions need component tests. Geometry needs a real
  browser test where actual CSS is loaded. Do not bypass authentication to view
  a private page. See the [engineering guide](docs/agents/engineering-guide.md).
- Generated map/graph: `pnpm graph`; freshness: `pnpm docs:check`. Add purposes
  in `.openape/workspace-purpose.json` when introducing a workspace.

## Merge, publish and hand off

Review the native PR diff and retain its source and target SHAs. Required
external checks must match that source. The merge API verifies both expected
SHAs and blocks protected-branch direct pushes; see
[branch protection](docs/operations/branch-protection.md).

Version with Changesets on a branch, merge the version PR, then publish from a
clean canonical main with `pnpm release:local`. Inspect deployments with
`pnpm deploy:image git --dry-run`; app images use the tested-image deployment
path, including health checks and rollback. Never substitute a mirror as the
release/deployment base. [Rollout evidence](docs/operations/ai-workflow.md).

The DDISA specification is the separate `protocol` repository on
`https://git.openape.ai/openape-ai/protocol`. For protocol-relevant changes,
read the relevant specification, verify behavior against it and identify any
intended deviation before implementation. Do not redefine the protocol in an
app or rewrite historical/specification links as part of a host migration.

Keep the current issue/PR, worktree, SHA, actual check evidence and next step in
[active work](docs/agents/active-work.md). Dated plans and old start prompts are
historical context; current code/configuration and verified live state decide.
