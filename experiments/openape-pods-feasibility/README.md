# OpenApe Pods feasibility probes

Development experiments for [issue 1346](https://git.openape.ai/openape-ai/openape/issues/1346)
and the [approved M0 scope](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2A2ZV0AAPDW75YMD4TVG8Q5).
Read [the findings and remaining gates](report.md) before interpreting results.
This is a standalone experiment, deliberately outside the production pnpm workspaces.
It adds no dependencies and is not an Electron product scaffold.

## Run M0a

On macOS, with Xcode command-line tools and the repository's pinned Node/pnpm:

```sh
# From the monorepo checkout, after pnpm install --frozen-lockfile:
. ./scripts/activate-node.sh
pnpm --dir experiments/openape-pods-feasibility lint
pnpm --dir experiments/openape-pods-feasibility typecheck
pnpm --dir experiments/openape-pods-feasibility build
pnpm --dir experiments/openape-pods-feasibility test
pnpm --dir experiments/openape-pods-feasibility test:boundaries
```

Run these gates sequentially and investigate a failure before continuing.
The last command currently exits **1** because the intentionally inherited
synthetic descriptor defeats the expected deny rule. Its companion clean-launch
case demonstrates descriptor hygiene. Do not change the unsafe case to PASS or
suppress the process exit code to claim feasibility.

The runner uses only invented local files and two ephemeral loopback listeners.
Every attempted operation first runs without the sandbox against fresh fixtures,
then runs under the policy against a different fresh copy. A control failure is
UNVERIFIED; a process crash cannot count as a successful denial. Children receive
a minimal explicit environment. Node and native process IDs are recorded in
stderr. Only the descriptor tests deliberately pass an open synthetic file.

Output is written to `.openape/check-results/pods-m0/` at the repository root.
Generated fixtures in this experiment's `.data/` are removed after each case;
an interrupted runner can leave disposable files there. No cleanup touches owner
files or other worktrees. The archived [evidence](evidence/boundaries.json) is a
dated observation, not a portable guarantee or substitute for rerunning tests.

No OAuth, packaged-runtime or live-Codex test script exists yet. M0b–M0e remain
pending. A missing probe must never become a skipped green gate. No live mail,
secret retrieval, real model turn or scheduled agent is needed for these probes.

## App Sandbox helper comparison

Requires Python 3 and Xcode clang. Run `pnpm --dir
experiments/openape-pods-feasibility test:helper` from the repository root. The
harness compiles its Foundation fixture with warnings as errors, constructs two
ad-hoc signed app bundles, verifies their signatures, and exercises file,
process and loopback boundaries. It uses no signing certificate or private key.

The current result is **4 PASS / 3 FAIL**, exit 1: two processes using the same
helper identity share the container; an unassigned host executable runs; enabling
networking permits an unassigned service. The [report](report.md) distinguishes
these development observations from supported release verification. The machine
result is `.openape/check-results/pods-m0/app-sandbox.json`.

Only unique newly generated helper containers are used. The harness removes its
fixture file, temporary bundles and those containers. It refuses an existing
container identity and never registers a login item or scheduled process.
