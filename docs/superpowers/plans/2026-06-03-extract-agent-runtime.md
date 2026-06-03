# `@openape/agent-runtime` Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move the agent-execution cluster (`lib/agent-runtime.ts` + `lib/agent-tools/` + `lib/coding/`, ~2.2k LOC) out of `@openape/apes` into a new `@openape/agent-runtime` package; apes re-exports the surface so the external `@openape/ape-agent` consumer is unaffected.

**Architecture:** Same proven pattern as the `@openape/shapes` extraction (`docs/superpowers/plans/2026-06-03-extract-shapes-package.md`). The cluster has only node-builtin outward deps (LLM injected via `RuntimeConfig`), so the package has no `@openape/*`/npm runtime deps. Spec: `docs/superpowers/specs/2026-06-03-extract-agent-runtime-design.md`.

**Tech Stack:** TypeScript, tsup, Vitest, pnpm/turbo.

---

## Task 1: Scaffold package + move the cluster

**Files:** create `packages/agent-runtime/{package.json,tsconfig.json,tsup.config.ts,vitest.config.ts,src/index.ts}`; `git mv` the cluster.

- [ ] **Step 1: Scaffold mirroring `packages/grants`** — name `@openape/agent-runtime`, version `0.1.0`, same scripts + `exports`/`main`/`types`. **Dependencies: none** beyond what an import-scan of the moved files reveals (recon found node-builtins only; if a moved file imports a bare npm pkg or `@openape/*`, add exactly that — but recon found none). devDeps: `typescript`, `vitest`, `@types/node` (catalog versions).

- [ ] **Step 2: Move the cluster with git mv**

```bash
cd packages/apes/src/lib
git mv agent-runtime.ts ../../../agent-runtime/src/agent-runtime.ts
git mv agent-tools ../../../agent-runtime/src/agent-tools
git mv coding ../../../agent-runtime/src/coding
```
Then move the cluster's tests into `packages/agent-runtime/`: locate them first (`ls ../../test | grep -E 'agent-runtime|agent-tools|coding'` and any co-located under the moved dirs). Move `agent-runtime.test.ts`, `agent-tools.test.ts`, `coding.test.ts` (+ co-located) into `packages/agent-runtime/test/` (mirror grants' test layout). Leave lifecycle tests (agents-bootstrap/spawn/destroy/deploy/list, agent-secrets-runtime) in apes — those test code that STAYS.

- [ ] **Step 3: Create the package `src/index.ts`**

```ts
export { runLoop, RpcSessionMap } from './agent-runtime.js'
export type { ChatMessage, RunOptions, RunResult, RuntimeConfig, RunStreamHandlers, TraceEntry } from './agent-runtime.js'
export { taskTools, TOOLS } from './agent-tools/index.js'
export type { ToolDefinition } from './agent-tools/index.js'
export { runApeShell } from './agent-tools/ape-shell-exec.js'
export type { ApeShellResult } from './agent-tools/ape-shell-exec.js'
```
(Verify each export resolves to the moved module; adjust the source path if a symbol lives elsewhere. If `runLoop`'s type exports differ from this list, match the actual `agent-runtime.ts` exports.)

- [ ] **Step 4: Install + build + test the package in isolation**

```bash
cd /Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo
pnpm install
pnpm --filter @openape/agent-runtime build
pnpm --filter @openape/agent-runtime test
```
Expected: builds; moved tests pass. If a moved file imports something now-unresolvable (a relative path that pointed outside the cluster), STOP and report — recon said outward edges are node-builtins only.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime packages/apes pnpm-lock.yaml
git commit -m "feat(agent-runtime): scaffold @openape/agent-runtime + move execution cluster"
```

---

## Task 2: Rewire apes to consume `@openape/agent-runtime`

**Files:** `packages/apes/package.json`; `packages/apes/src/index.ts`; `packages/apes/src/commands/agents/{run,serve,code}.ts`; `packages/apes/src/commands/nest/authorize.ts` (+ any other consumer a grep finds).

- [ ] **Step 1: Add dependency** — `"@openape/agent-runtime": "workspace:*"` to `packages/apes/package.json` dependencies; `pnpm install`.

- [ ] **Step 2: Rewire consumers** — grep first: `grep -rn "from '\.\./\.\./lib/agent-runtime\|from '\.\./\.\./lib/agent-tools\|lib/coding\|from '\.\./lib/agent" packages/apes/src`. In each hit (commands/agents/{run,serve,code}, commands/nest/authorize, any others), change imports of cluster symbols from the old `../../lib/agent-runtime`/`../../lib/agent-tools`/`../../lib/coding` paths to `@openape/agent-runtime`.

- [ ] **Step 3: Fix apes `src/index.ts` re-export** — replace the old cluster export lines (currently `export { runLoop, RpcSessionMap } from './lib/agent-runtime'` etc., lines ~51-63) with re-exports from the package, preserving the SAME public names:
```ts
export { runLoop, RpcSessionMap, taskTools, TOOLS, runApeShell } from '@openape/agent-runtime'
export type { ChatMessage, RunOptions, RunResult, RuntimeConfig, RunStreamHandlers, TraceEntry, ToolDefinition, ApeShellResult } from '@openape/agent-runtime'
```
(Keep the rest of apes/index.ts — shapes/config/http/etc. — unchanged.)

- [ ] **Step 4: Verify no stale relative imports remain**

```bash
grep -rn "lib/agent-runtime\|lib/agent-tools\|lib/coding" packages/apes/src
```
Expected: empty (the cluster is gone from apes; all references go through `@openape/agent-runtime`). If a STAYED file (e.g. agent-bootstrap.ts, llm-bridge.ts) imported a cluster symbol, rewire it to `@openape/agent-runtime` too.

- [ ] **Step 5: Typecheck + test apes**

```bash
pnpm --filter @openape/apes typecheck && pnpm --filter @openape/apes test
```
Expected: exit 0; apes tests pass unchanged (only mock/import-path retargets allowed — NO assertion changes). If a cluster symbol isn't exported from the package, add it to the package index (Task 1 Step 3) and rebuild.

- [ ] **Step 6: Commit**

```bash
git add packages/apes
git commit -m "refactor(apes): consume @openape/agent-runtime; re-export surface"
```

---

## Task 3: Changeset + full gate

- [ ] **Step 1: Changeset** — `.changeset/extract-agent-runtime.md`:
```markdown
---
"@openape/agent-runtime": minor
"@openape/apes": minor
---

Extract the agent-execution cluster (in-process run loop, agent tools, coding agent) from `@openape/apes` into a new dependency-light `@openape/agent-runtime` package. apes re-exports the surface, so `@openape/ape-agent` is unaffected. No behaviour change.
```

- [ ] **Step 2: Full gate** — `pnpm lint && pnpm typecheck && pnpm test` (if e2e `EADDRINUSE :::3000`, `lsof -ti :3000 | xargs kill` then re-run). Expected exit 0.

- [ ] **Step 3: Commit** — `git add .changeset/extract-agent-runtime.md && git commit -m "chore: changeset for @openape/agent-runtime extraction"`

---

## Definition of Done

- `packages/agent-runtime/` exists as `@openape/agent-runtime` (builds, moved tests pass), exporting the cluster surface; no `@openape/*`/npm runtime deps.
- `packages/apes/src/lib/` no longer contains `agent-runtime.ts`, `agent-tools/`, `coding/`. Grep `lib/agent-runtime|lib/agent-tools|lib/coding` in `packages/apes/src` → empty.
- apes public library surface unchanged; `@openape/ape-agent` needs no changes.
- Moved test bodies byte-identical to originals (no weakened assertions); full gate green; changeset present.
