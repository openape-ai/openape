# Static analysis

## Dependency graph
`pnpm graph` regenerates [dependency-graph.md](./dependency-graph.md) — a deterministic
Mermaid view of the `@openape/*` workspace dependencies, generated from each
package's `package.json` so it can never drift from the code.

## knip (dead code / unused deps) — advisory

`pnpm knip` reports unused files, exports, types and dependencies. Run it
locally before merging anything that removes or rewires code; it stays out of CI
on purpose. The target state is a real zero — no findings because there is no
dead code, not because the config looks away — so a new finding is either dead
code to delete or a gap in `knip.jsonc` that needs a commented rule, never a
line added to `ignore` without a reason.

`pnpm knip` runs `scripts/knip-workspaces.mjs`, which analyses one workspace per
process. A single whole-repo pass is not trustworthy: knip's Nuxt plugin
registers its auto-import compiler globally and the first Nuxt workspace wins,
so every other app's components and composables read as unreferenced (~50 false
positives). Pass extra flags through as usual, e.g. `pnpm knip --production`.

Status (2026-08-03): clean across all 41 workspaces after narrowing the `entry`
patterns to real framework entry points. The earlier "1 finding" green was an
artefact — `apps/*/{app,server,shared}/**` and `modules/*/src/runtime/**` were
declared as entry, which exempted ~41% of the code from export analysis.
