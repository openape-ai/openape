# `@openape/shapes` Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move the pure Shapes library core out of `packages/apes/src/shapes/` into a new publishable `@openape/shapes` package, leaving the grant-orchestration + CLI glue in apes.

**Architecture:** New `packages/shapes` (deps: `@openape/core`, `@openape/grants`). The pure modules + their tests move via `git mv`. `apes` gains `@openape/shapes` as a dependency; the stayers (`shapes/grants.ts`, `shapes/commands/`, `shapes/cli.ts`) and the ~10 consumers import the core from `@openape/shapes`. apes's public library surface is preserved by re-exporting the moved functions from `@openape/shapes` plus the stayed ones.

**Tech Stack:** TypeScript, tsup, Vitest, pnpm/turbo. Spec: `docs/superpowers/specs/2026-06-03-extract-shapes-package-design.md`.

---

## File Structure

**New package `packages/shapes/`:**
- `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts` — mirror `packages/grants`.
- `src/` ← moved from `packages/apes/src/shapes/`: `adapters.ts`, `audit.ts`, `capabilities.ts`, `config.ts`, `generic.ts`, `http.ts`, `installer.ts`, `parser.ts`, `registry.ts`, `request-builders.ts`, `shell-parser.ts`, `toml.ts`, `types.ts` + their tests.
- `src/index.ts` — new, exports only the pure surface (see spec export-split).

**Stays in `packages/apes/src/shapes/`:** `grants.ts`, `commands/`, `cli.ts` (+ their tests) — rewired to import from `@openape/shapes`.

**Rewired apes consumers:** `src/index.ts`, `src/shell/{apes-self-dispatch,session,grant-dispatch}.ts`, `src/commands/{run,explain,proxy,mcp/tools}.ts`, `src/commands/grants/{request-capability,run}.ts`.

---

## Task 1: Scaffold the package + move the pure modules

**Files:** create `packages/shapes/{package.json,tsconfig.json,tsup.config.ts,vitest.config.ts,src/index.ts}`; `git mv` the pure modules.

- [ ] **Step 1: Scaffold package config mirroring `packages/grants`**

Read `packages/grants/package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`. Create the equivalents under `packages/shapes/` with name `@openape/shapes`, version `0.1.0`, the same scripts (`build`/`test`/`lint`/`typecheck`), `exports`/`main`/`types` pointing at `dist/index.js`/`dist/index.d.ts`, and dependencies `@openape/core: workspace:*`, `@openape/grants: workspace:*` plus any external dep the moved modules use (check imports in the moved files: e.g. a TOML parser used by `toml.ts`, `consola`, etc. — add exactly those that the MOVED modules import; do NOT add deps only used by the stayers). Match catalog versions from `pnpm-workspace.yaml`.

- [ ] **Step 2: Move the pure modules + tests with git mv**

```bash
cd packages/apes/src/shapes
git mv adapters.ts audit.ts capabilities.ts config.ts generic.ts http.ts installer.ts parser.ts registry.ts request-builders.ts shell-parser.ts toml.ts types.ts ../../../shapes/src/
```
Then move the corresponding test files (find them first: `ls __tests__ 2>/dev/null; ls *.test.ts 2>/dev/null`) for those modules into `packages/shapes/src/` (or `packages/shapes/src/__tests__/`, mirroring grants' test layout). Leave tests for `grants.ts`/`commands/`/`cli.ts` in apes.

- [ ] **Step 3: Create the package `src/index.ts`**

Export ONLY the pure surface (per spec). Concretely re-export from the moved modules:
```ts
export { appendAuditLog } from './audit.js'
export { loadAdapter, loadOrInstallAdapter, resolveAdapterPath, tryLoadAdapter } from './adapters.js'
export { resolveCapabilityRequest } from './capabilities.js'
export { buildExactCommandGrantRequest, buildStructuredCliGrantRequest } from './request-builders.js'
export { parseShellCommand, extractShellCommandString } from './shell-parser.js'
export { resolveCommand } from './parser.js'
export { fetchRegistry, findAdapter, searchAdapters } from './registry.js'
export { findConflictingAdapters, getInstalledDigest, installAdapter, isInstalled, removeAdapter } from './installer.js'
export { discoverEndpoints } from './http.js'
export type {
  AdapterMeta, BuiltGrantRequest, GrantRequestOptions, LoadedAdapter,
  RegistryEntry, RegistryIndex, ResolvedCapability, ResolvedCommand,
  ShapesAdapter, ShapesOperation,
} from './types.js'
```
(Adjust if a name actually lives in a different moved module — verify each export resolves. Do NOT export `createShapesGrant`/`verifyAndExecute`/`fetchGrantToken`/`findExistingGrant`/`waitForGrantStatus`/`extractOption`/`extractWrappedCommand` — those stay in apes.)

- [ ] **Step 4: Install + build the new package in isolation**

```bash
cd /Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo
pnpm install
pnpm --filter @openape/shapes build
pnpm --filter @openape/shapes test
```
Expected: builds; moved tests pass. If a moved module still imports a relative `../` path that no longer resolves (e.g. it imported apes' top-level `config`/`http`/`audit`), STOP and report — per the spec the pure modules should only import each other + `@openape/core`/`@openape/grants`/node builtins. (Note: the moved `shapes/config.ts`/`http.ts`/`audit.ts` are the shapes-local ones; relative imports among moved files stay valid.)

- [ ] **Step 5: Commit**

```bash
git add packages/shapes packages/apes pnpm-lock.yaml
git commit -m "feat(shapes): scaffold @openape/shapes package + move pure modules"
```

---

## Task 2: Rewire apes to consume `@openape/shapes`

**Files:** `packages/apes/package.json`; `packages/apes/src/shapes/{grants.ts,cli.ts}`; `packages/apes/src/shapes/commands/*.ts`; the ~10 consumers; `packages/apes/src/index.ts`.

- [ ] **Step 1: Add the dependency**

In `packages/apes/package.json` add `"@openape/shapes": "workspace:*"` to `dependencies`. Run `pnpm install`.

- [ ] **Step 2: Rewire the stayers (`grants.ts`, `commands/`, `cli.ts`)**

In `packages/apes/src/shapes/grants.ts`, `commands/*.ts`, `cli.ts`: replace relative imports of the MOVED modules (e.g. `from './adapters.js'`, `from './parser.js'`, `from './registry.js'`, `from './installer.js'`, `from './capabilities.js'`, `from './request-builders.js'`, `from './types.js'`, `from './audit.js'`, `from './http.js'`, `from './config.js'` WHERE that `config`/`http`/`audit` is the shapes-local one) with `from '@openape/shapes'`. Keep relative imports that point at things STILL in apes (`./grants.js` from commands/cli; apes' top-level `../config.js`/`../audit/…` from grants.ts). Grep to verify: after this step, no file imports a moved module via a relative path.

- [ ] **Step 3: Rewire the ~10 consumers**

In `src/index.ts`, `src/shell/{apes-self-dispatch,session,grant-dispatch}.ts`, `src/commands/{run,explain,proxy}.ts`, `src/commands/mcp/tools.ts`, `src/commands/grants/{request-capability,run}.ts`: change imports of moved-module functions from `'../shapes/…'`/`'./shapes/…'` to `'@openape/shapes'`. Functions that stay (grants.ts orchestration, `extractOption`/`extractWrappedCommand`) keep importing from `../shapes/grants.js` / `../shapes/commands/explain.js` respectively.

- [ ] **Step 4: Fix the apes library `src/index.ts` export split**

`packages/apes/src/index.ts` must preserve the public surface: re-export the pure functions/types from `@openape/shapes`, and keep re-exporting the stayed ones from their apes locations:
```ts
export {
  appendAuditLog, buildExactCommandGrantRequest, buildStructuredCliGrantRequest,
  extractShellCommandString, fetchRegistry, findAdapter, findConflictingAdapters,
  getInstalledDigest, installAdapter, isInstalled, loadAdapter, loadOrInstallAdapter,
  parseShellCommand, removeAdapter, resolveAdapterPath, resolveCapabilityRequest,
  resolveCommand, searchAdapters, tryLoadAdapter,
} from '@openape/shapes'
export type {
  AdapterMeta, BuiltGrantRequest, GrantRequestOptions, LoadedAdapter, RegistryEntry,
  RegistryIndex, ResolvedCapability, ResolvedCommand, ShapesAdapter, ShapesOperation,
} from '@openape/shapes'
// stayed in apes:
export { createShapesGrant, fetchGrantToken, findExistingGrant, verifyAndExecute, waitForGrantStatus } from './shapes/grants.js'
export { extractOption, extractWrappedCommand } from './shapes/commands/explain.js'
```
(Keep the rest of apes/index.ts — config/http/duration/errors/agent-runtime exports — unchanged.)

- [ ] **Step 5: Typecheck + test apes**

```bash
pnpm --filter @openape/apes typecheck
pnpm --filter @openape/apes test
```
Expected: exit 0; all apes tests (incl. the stayed grants/commands tests) pass unchanged. If a moved-module symbol isn't exported from `@openape/shapes`, add it to the package index (Task 1 Step 3) and rebuild `@openape/shapes` first.

- [ ] **Step 6: Commit**

```bash
git add packages/apes
git commit -m "refactor(apes): consume @openape/shapes; keep grant-orchestration + CLI glue"
```

---

## Task 3: Changeset + full gate

- [ ] **Step 1: Changeset**

Create `.changeset/extract-shapes-package.md`:
```markdown
---
"@openape/shapes": minor
"@openape/apes": minor
---

Extract the pure Shapes library core (parser, adapters, registry, installer, toml, capabilities, request-builders, shell-parser, types, audit, http, config) from `@openape/apes` into a new `@openape/shapes` package. Grant-orchestration and CLI glue stay in apes and consume the package. No behaviour change.
```

- [ ] **Step 2: Full gate**

```bash
pnpm lint && pnpm typecheck && pnpm test
```
Expected: exit 0. If e2e fails with `EADDRINUSE :::3000`, `lsof -ti :3000 | xargs kill` then re-run.

- [ ] **Step 3: Commit**

```bash
git add .changeset/extract-shapes-package.md
git commit -m "chore: changeset for @openape/shapes extraction"
```

---

## Definition of Done

- `packages/shapes/` exists as `@openape/shapes` (builds, moved tests pass), exporting only the pure surface.
- `packages/apes/src/shapes/` contains only `grants.ts`, `commands/`, `cli.ts` (+ their tests); no pure module remains there. Grep: `ls packages/apes/src/shapes/*.ts` shows only `grants.ts`, `cli.ts`.
- No apes file imports a moved module via a relative path (all via `@openape/shapes`).
- apes public library surface unchanged (same exports from `src/index.ts`).
- Full gate green; changeset present.
