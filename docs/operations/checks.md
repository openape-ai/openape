# Shared check contract

`scripts/check.mjs` and `.openape/checks.json` define the local and CI checks.

- `pnpm check:affected --base origin/main --head HEAD` selects changed workspaces
  and all transitive consumers, including local tracked and untracked changes.
  Root configuration/tooling changes select every workspace. When base equals
  head, the previous commit is used; an initial commit needs an explicit base.
- `pnpm check:ci` runs the complete merge gate: unit, E2E and real-browser layout.
  The pre-push hook runs only the affected unit suite (owner decision 2026-09-23,
  issue 1364), so a push takes seconds and never starts Electron or Xcode on a
  developer machine that shares the macOS runner. The external checks run the
  affected E2E and layout suites once per pushed head and are the required merge
  evidence.
- `--suite unit`, `--suite e2e`, `--suite layout` split the same contract across
  runners. All three suites are required for a complete merge result.
- `--dry-run` prints resolved SHAs, dirty state, workspace selection and commands.

Consumed libraries/modules and the three consumed CLI applications are built
serially before checks. Unit checks include production dependency audit,
repository tooling tests, lint, typecheck and workspace tests. Missing scripts
fail before execution; current coverage gaps are explicit reviewed exceptions
in the contract. An exception does not imply that a test exists or passed.

The native iOS client `@openape/pods-ios` is outside the contract by owner
decision (2026-09-23, issue 1364): the gate covers the desktop app, and iOS is a
separate topic. Its Xcode checks run only on demand with
`pnpm --filter @openape/pods-ios test:layout`.

Each invocation writes complete step logs and a machine-readable summary under
`.openape/check-results/<run>/`. E2E invocations also write Vitest JSON reports.
The first failed step returns nonzero and preserves its log. These local files
are ignored by Git. CI attaches the directory as an artifact and preserves the
existing E2E proof-link manifest. Forgejo requires upload-artifact v3 or a
patched v4: https://forgejo.org/docs/latest/user/actions/advanced-features/

Forgejo workflows run on every mirrored branch at the exact source commit.
Branch heads run `check:affected --base origin/main`, so the required merge
evidence covers only the workspaces the head changed; pushes to `main` run the
complete contract as the post-merge safety net. Documentation under `docs/`
(except `docs/architecture/`), `.claude/` and root Markdown files never select
a workspace; a head that changes only those files passes with zero steps. The native forge's required checks are enabled only after the external
runner and status adapter have been verified (rollout M4).
