# External CI and protected branches

The path is: authenticated Git push or native merge → current-ref mirror scan →
authenticated Forgejo push → existing isolated Forgejo runner → shared check
contract → Forgejo commit status. The native forge queries that status directly
for the exact reviewed SHA. No CI build runs inside the native forge process.

Each workflow retains complete check logs as an artifact. Its final reporting
step receives the repo-scoped `APE_GIT_STATUS_SECRET` and sends a signed bounded
log excerpt to native commit statuses. Earlier check steps do not receive that
secret. Required-check decisions use Forgejo's results; a native HMAC status with
an identical context cannot override them. Excerpts are combined with the
provider status only when commit, context, outcome and workflow run agree.

## Configure after acceptance

Owner-only `POST /api/repos/:owner/:name/protections` accepts:

```json
{
  "branch": "main",
  "mirrorId": "<enabled Forgejo mirror ID>",
  "contexts": ["CI / ci (push)", "e2e / e2e (push)", "layout / layout (push)"],
  "enabled": true,
  "reason": "External runner path and negative acceptance cases verified"
}
```

`GET .../protections` exposes configuration and its audit trail to repository
readers. Disabled policies can preview external results without blocking a
bootstrap merge. Activate production protection only after all required suites
have produced real results. Contexts must use the exact names returned by the
Forgejo status endpoint; missing/error/offline is a blocking result.

## Merge contract

Read the PR, review its diff and retain `sourceSha` and `targetSha`. Send both as
`expectedSourceSha` and `expectedTargetSha` to `POST .../pulls/:number/merge`.
A missing or changed pair returns 409. Required checks must be successful for
that source. Git verifies the source ref and updates the target in one atomic
transaction, preventing an intervening source push or target update from
changing what was approved.

Protected branch refs reject direct updates, force pushes and deletions through
Git transport, including owner/admin pushes. Normal work goes through feature
branches and checked merges. No client environment variable bypasses the
server policy.

## Recovery

For an actual runner/provider outage, the repository owner can temporarily
submit the same policy with `enabled: false` and a specific incident reason.
The policy change and actor are persisted in `protection_events`; it is not an
unlogged special push credential. Restore protection immediately after the
incident, and record the resulting commit and verification in the incident.
This path is an operational capability, not permission to bypass a failed test.

The reference `.ape-ci.sh` consumer remains available for small trusted repos;
the monorepo uses the existing external Docker/mac runners. Check code is
untrusted process input: keep job containers disposable, status-report secrets
repo-scoped, and run layout only on the dedicated CI runner account.

Runner caches are restored per OS, suite and lockfile, with the commit in the
save key. Turbo still validates each task's input hash; E2E and layout execute
fresh. The cache directory is explicit via `TURBO_CACHE_DIR` and remains ignored
by Git. Reference: https://turborepo.dev/docs/reference/system-environment-variables
