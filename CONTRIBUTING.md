# Contributing to OpenApe

Start with [AGENTS.md](AGENTS.md) and the generated
[workspace map](docs/architecture/workspace-map.md).

Code, pushes and pull requests use
[repos.openape.ai/patrick/monorepo](https://repos.openape.ai/patrick/monorepo).
[Native issues](https://repos.openape.ai/patrick/monorepo/issues) own development
discussion and resolution. Forgejo retains the read-only issue archive and CI;
Forgejo and GitHub remain code mirrors. `gh` is not a client for the native forge.
Use [the issue CLI](docs/operations/native-issues.md) with your DDISA identity.
General tasks/reminders remain in Tasks and approved proposals remain in Plans;
link their canonical issue instead of copying its lifecycle.

1. Select an issue and inspect the existing checkout status.
2. Create a branch `<type>/issue-<number>-<description>` from canonical main,
   preferably in a dedicated worktree. Preserve other worktrees and local work.
3. Select the installed Node pin with `. ./scripts/activate-node.sh` and install
   using `pnpm install --frozen-lockfile`. Run focused checks while developing.
4. Commits run branch and lockfile guards only. The pre-push hook runs the
   complete affected unit contract once, including lint/typecheck; do not add
   a duplicate full or affected gate before commits. For handoff without a push,
   run `pnpm check:affected --base origin/main --head HEAD --suite unit` once.
   App changes also require an app build and relevant tests. E2E/layout remain
   manual; deployments require full `pnpm check:ci`.
   [Check details and logs](docs/operations/checks.md).
5. Push the branch to the canonical remote and open a native PR. Include the
   complete native issue URL, behavior change and actual validation evidence.
   Add an explicit issue/PR relation; closing keywords do not change issue state.
6. Review the exact source/target pair and local check evidence. CI is paused
   by owner decision (issue 1448); do not reactivate it or wait for external
   checks while paused. Merge with the reviewed pair; if either changes,
   review again.
   [Branch policy and recovery](docs/operations/branch-protection.md).
7. Update the issue/plan and [active work](docs/agents/active-work.md) with the
   resulting commit, evidence and next step. Do not close an umbrella issue
   while approved work remains.

Version changes use Changesets on a branch. Merge the version PR before
publishing from clean canonical main via `pnpm release:local`. Deployments use
the tested-image path and health gate. See the
[engineering guide](docs/agents/engineering-guide.md) for UI tests, protocol
compliance, style and deployment details.

For a single-package release, keep the publication scope explicit:
`pnpm run release:local -- --filter @openape/cli-auth --dry-run`, then the same
command without `--dry-run`. The filter validates the package name and publishes
only that package; no other unpublished versions are included. Without a filter,
the command retains its existing all-unpublished-packages scope. A selected
package's required workspace dependencies must already be published. Releasing
cli-auth alone does not update already installed CLIs or publish new CLI bundles.

Generated map/graph changes are produced by `pnpm graph` and checked by
`pnpm docs:check`. Supply-chain quarantine is kept intact; a failed install or
security audit is investigated, not bypassed.
