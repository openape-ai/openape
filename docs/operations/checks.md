# Shared check contract

`scripts/check.mjs` and `.openape/checks.json` define the local and CI checks.

- `pnpm check:affected --base origin/main --head HEAD` selects changed workspaces
  and all transitive consumers, including local tracked and untracked changes.
  Root configuration/tooling changes select every workspace. When base equals
  head, the previous commit is used; an initial commit needs an explicit base.
- `pnpm check:ci` runs the complete merge gate: unit, E2E and real-browser layout.
- `--suite unit`, `--suite e2e`, `--suite layout` split the same contract across
  runners. All three suites are required for a complete merge result.
- `--dry-run` prints resolved SHAs, dirty state, workspace selection and commands.

Consumed libraries/modules and the three consumed CLI applications are built
serially before checks. Unit checks include production dependency audit,
repository tooling tests, lint, typecheck and workspace tests. Missing scripts
fail before execution; current coverage gaps are explicit reviewed exceptions
in the contract. An exception does not imply that a test exists or passed.

Each invocation writes complete step logs and a machine-readable summary under
`.openape/check-results/<run>/`. E2E invocations also write Vitest JSON reports.
The first failed step returns nonzero and preserves its log. These local files
are ignored by Git. CI attaches the directory as an artifact and preserves the
existing E2E proof-link manifest. Forgejo requires upload-artifact v3 or a
patched v4: https://forgejo.org/docs/latest/user/actions/advanced-features/

Forgejo workflows run on every mirrored branch at the exact source commit.
They use the full contract, without an affected comparison against the same
main tip. The native forge's required checks are enabled only after the external
runner and status adapter have been verified (rollout M4).
