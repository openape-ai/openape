# Static analysis

## Dependency graph
`pnpm graph` regenerates [dependency-graph.md](./dependency-graph.md) — a deterministic
Mermaid view of the `@openape/*` workspace dependencies, generated from each
package's `package.json` so it can never drift from the code.

## knip (dead code / unused deps) — advisory

`pnpm knip` reports unused files, exports, types and dependencies across the
workspace. It is **advisory only** (not wired into CI) until its baseline is
triaged: the first run is noise-dominated (publishable packages export public
API that knip can't see is consumed by external npm users; Nuxt auto-imports and
server routes need per-app config). Treat the first run as a worklist, not a
failure — tune `knip.json` per workspace, then consider a non-blocking CI job.

First-run baseline (2026-06-27): 163 unused files, 138 unused exports, 59 unused
deps, 22 unused devDeps, 91 unlisted deps — the bulk are config-tuning false
positives, NOT confirmed dead code. Do not bulk-delete from this list.
