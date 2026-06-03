# Shape-Matcher Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the ~150 lines of identical argv→shape-operation matching logic shared by `grants/server-resolver.ts` and `apes/shapes/parser.ts` into a single `@openape/grants` module, leaving each resolver as a thin I/O wrapper.

**Architecture:** New `packages/grants/src/shape-matcher.ts` exports a `ShapeMatchOperation` interface + `matchArgvToOperation()` (pure matcher) + `buildCliAuthDetail()` (detail builder). Both resolvers delete their helper copies and call these; each keeps its own input adaptation, executable policy, no-match behavior, and output shape. Behavior is unchanged — verified by the existing server-resolver and parser test suites staying green.

**Tech Stack:** TypeScript, Vitest, tsup, pnpm/turbo. `@openape/grants` (consumed by `@openape/apes` via `workspace:*`).

**Spec:** `docs/superpowers/specs/2026-06-03-shape-matcher-extraction-design.md`

---

## File Structure

- **Create:** `packages/grants/src/shape-matcher.ts` — the shared matcher: `ShapeMatchOperation`, module-private helpers (`parseOptionArgs`, `resolveBindingToken`, `renderTemplate`, `parseResourceChain`, `matchOperation`, `expandCombinedFlags`), and public `matchArgvToOperation()` + `buildCliAuthDetail()`.
- **Create:** `packages/grants/src/__tests__/shape-matcher.test.ts` — focused unit tests.
- **Modify:** `packages/grants/src/index.ts` — export the new public surface.
- **Modify:** `packages/grants/src/server-resolver.ts` — delete the duplicated helpers; import + use the shared matcher; keep ServerShape adaptation, lenient executable, generic fallback, `ServerResolvedCommand` output.
- **Modify:** `packages/apes/src/shapes/parser.ts` — delete the duplicated helpers; import the matcher from `@openape/grants`; keep executable check, throw-on-no-match, `ResolvedCommand` output.
- **Create:** `.changeset/shape-matcher-extraction.md` — `@openape/grants` minor.

Both `ServerShapeOperation` (grants/shape-registry.ts) and `ShapesOperation` (apes/shapes/types.ts) already have identical fields (`id`, `command`, `positionals?`, `required_options?`, `display`, `action`, `risk`, `resource_chain`, `exact_command?`) → both structurally assignable to `ShapeMatchOperation`.

---

## Task 1: Create the shared `shape-matcher` module (TDD)

**Files:**
- Create: `packages/grants/src/shape-matcher.ts`
- Create: `packages/grants/src/__tests__/shape-matcher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/grants/src/__tests__/shape-matcher.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildCliAuthDetail, matchArgvToOperation, type ShapeMatchOperation } from '../shape-matcher.js'

const ops: ShapeMatchOperation[] = [
  {
    id: 'gh.repo.list',
    command: ['repo', 'list'],
    positionals: ['owner'],
    display: 'List repos for {owner}',
    action: 'list',
    risk: 'low',
    resource_chain: ['owner:login={owner}', 'repo:*'],
  },
  {
    id: 'gh.repo.delete',
    command: ['repo', 'delete'],
    positionals: ['slug'],
    required_options: ['confirm'],
    display: 'Delete {slug}',
    action: 'delete',
    risk: 'high',
    resource_chain: ['repo:name={slug}'],
    exact_command: true,
  },
]

describe('matchArgvToOperation', () => {
  it('matches a command prefix + positional binding', () => {
    const m = matchArgvToOperation(ops, ['repo', 'list', 'openape'])
    expect(m?.operation.id).toBe('gh.repo.list')
    expect(m?.bindings.owner).toBe('openape')
  })

  it('returns null when nothing matches', () => {
    expect(matchArgvToOperation(ops, ['issue', 'list'])).toBeNull()
  })

  it('enforces required_options', () => {
    expect(matchArgvToOperation(ops, ['repo', 'delete', 'a/b'])).toBeNull()
    const m = matchArgvToOperation(ops, ['repo', 'delete', 'a/b', '--confirm'])
    expect(m?.operation.id).toBe('gh.repo.delete')
  })

  it('parses --k=v and --k v options into bindings', () => {
    const m = matchArgvToOperation(
      [{ id: 'x', command: ['run'], display: 'd', action: 'exec', risk: 'low', resource_chain: [], required_options: ['env'] }],
      ['run', '--env=prod'],
    )
    expect(m?.bindings.env).toBe('prod')
  })

  it('expands combined single-letter flags (-rl → -r -l)', () => {
    const m = matchArgvToOperation(
      [{ id: 'ls', command: ['ls'], display: 'd', action: 'list', risk: 'low', resource_chain: [], required_options: ['r', 'l'] }],
      ['ls', '-rl'],
    )
    expect(m?.operation.id).toBe('ls')
  })

  it('prefers the most specific (longest command prefix) match', () => {
    const two: ShapeMatchOperation[] = [
      { id: 'a', command: ['repo'], display: 'd', action: 'x', risk: 'low', resource_chain: [] },
      { id: 'b', command: ['repo', 'list'], display: 'd', action: 'x', risk: 'low', resource_chain: [] },
    ]
    expect(matchArgvToOperation(two, ['repo', 'list'])?.operation.id).toBe('b')
  })
})

describe('buildCliAuthDetail', () => {
  it('builds a detail with rendered display, resource chain, and a canonical permission', () => {
    const m = matchArgvToOperation(ops, ['repo', 'list', 'openape'])!
    const detail = buildCliAuthDetail('gh', m.operation, m.bindings)
    expect(detail.type).toBe('openape_cli')
    expect(detail.cli_id).toBe('gh')
    expect(detail.operation_id).toBe('gh.repo.list')
    expect(detail.display).toBe('List repos for openape')
    expect(detail.resource_chain).toEqual([{ resource: 'owner', selector: { login: 'openape' } }, { resource: 'repo' }])
    expect(detail.permission.length).toBeGreaterThan(0)
  })

  it('sets exact_command constraint when the operation requires it', () => {
    const m = matchArgvToOperation(ops, ['repo', 'delete', 'a/b', '--confirm'])!
    const detail = buildCliAuthDetail('gh', m.operation, m.bindings)
    expect(detail.constraints?.exact_command).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openape/grants test -- shape-matcher`
Expected: FAIL — `Cannot find module '../shape-matcher.js'`.

- [ ] **Step 3: Create the module**

Create `packages/grants/src/shape-matcher.ts`. Move the helper functions VERBATIM from `packages/grants/src/server-resolver.ts` (they are the canonical copies) and add the two public functions + interface:

```ts
import type { OpenApeCliAuthorizationDetail, OpenApeCliResourceRef, ScopeRiskLevel } from '@openape/core'
import { canonicalizeCliPermission } from './cli-permissions.js'

/**
 * Minimal operation shape the matcher reads. Both `ServerShapeOperation`
 * (shape-registry.ts) and apes' `ShapesOperation` are structurally assignable
 * to this — they share the same field set.
 */
export interface ShapeMatchOperation {
  id: string
  command: string[]
  positionals?: string[]
  required_options?: string[]
  display: string
  action: string
  risk: ScopeRiskLevel
  resource_chain: string[]
  exact_command?: boolean
}

function parseOptionArgs(
  tokens: string[],
  valueOptions?: string[],
): { options: Record<string, string>, positionals: string[] } {
  const options: Record<string, string> = {}
  const positionals: string[] = []
  const takesValue = new Set(valueOptions ?? [])

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (token.startsWith('--')) {
      const stripped = token.slice(2)
      const eqIndex = stripped.indexOf('=')
      if (eqIndex >= 0) {
        options[stripped.slice(0, eqIndex)] = stripped.slice(eqIndex + 1)
        continue
      }
      const next = tokens[index + 1]
      if (next && !next.startsWith('-')) {
        options[stripped] = next
        index += 1
        continue
      }
      options[stripped] = 'true'
    }
    else if (token.startsWith('-') && token.length > 1 && !/^-\d/.test(token)) {
      const key = token.slice(1)
      if (key.length === 1 && !takesValue.has(key)) {
        options[key] = 'true'
      }
      else {
        const next = tokens[index + 1]
        if (next && !next.startsWith('-')) {
          options[key] = next
          index += 1
        }
        else {
          options[key] = 'true'
        }
      }
    }
    else {
      positionals.push(token)
    }
  }
  return { options, positionals }
}

function resolveBindingToken(binding: string, bindings: Record<string, string>): string {
  const match = binding.match(/^\{([^}|]+)(?:\|([^}]+))?\}$/)
  if (!match) return binding
  const [, name, transform] = match
  const value = bindings[name!]
  if (!value) throw new Error(`Missing binding: ${name}`)
  if (!transform) return value
  if (transform === 'owner' || transform === 'name') {
    const [owner, repo] = value.split('/')
    if (!owner || !repo) throw new Error(`Binding ${name} must be in owner/name form`)
    return transform === 'owner' ? owner : repo
  }
  throw new Error(`Unsupported binding transform: ${transform}`)
}

function renderTemplate(template: string, bindings: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_, expression: string) => resolveBindingToken(`{${expression}}`, bindings))
}

function parseResourceChain(chain: string[], bindings: Record<string, string>): OpenApeCliResourceRef[] {
  return chain.map((entry) => {
    const [resource, selectorSpec = '*'] = entry.split(':', 2)
    if (!resource) throw new Error(`Invalid resource chain entry: ${entry}`)
    if (selectorSpec === '*') return { resource }
    const selector = Object.fromEntries(
      selectorSpec.split(',').map((segment) => {
        const [key, rawValue] = segment.split('=', 2)
        if (!key || !rawValue) throw new Error(`Invalid selector segment: ${segment}`)
        return [key, renderTemplate(rawValue, bindings)]
      }),
    )
    return { resource, selector }
  })
}

function matchOperation(
  operation: ShapeMatchOperation,
  argv: string[],
): Record<string, string> | null {
  if (argv.length < operation.command.length) return null
  const prefix = argv.slice(0, operation.command.length)
  if (prefix.join('\0') !== operation.command.join('\0')) return null
  const remainder = argv.slice(operation.command.length)
  const { options, positionals } = parseOptionArgs(remainder, operation.required_options)
  const expectedPositionals = operation.positionals ?? []
  if (positionals.length !== expectedPositionals.length) return null
  for (const option of operation.required_options ?? []) {
    if (!options[option]) return null
  }
  const bindings: Record<string, string> = { ...options }
  for (let index = 0; index < expectedPositionals.length; index += 1) {
    const name = expectedPositionals[index]!
    const value = positionals[index]!
    if (name.startsWith('=')) {
      if (value !== name.slice(1)) return null
      continue
    }
    bindings[name] = value
  }
  return bindings
}

function expandCombinedFlags(argv: string[]): string[] {
  return argv.flatMap((token) => {
    if (token.startsWith('-') && !token.startsWith('--') && token.length > 2 && /^-[a-z]+$/i.test(token)) {
      return Array.from(token.slice(1), c => `-${c}`)
    }
    return [token]
  })
}

function tryMatch<T extends ShapeMatchOperation>(
  operations: T[],
  argv: string[],
): Array<{ operation: T, bindings: Record<string, string> }> {
  return operations.flatMap((operation) => {
    try {
      const bindings = matchOperation(operation, argv)
      return bindings ? [{ operation, bindings }] : []
    }
    catch {
      return []
    }
  })
}

/**
 * Match a command argv (executable already stripped) against a list of shape
 * operations. Pass 1 exact; pass 2 with combined single-letter flags expanded.
 * On multiple matches, prefers the most specific (longest command prefix).
 * Returns null when nothing matches — callers decide the consequence.
 */
export function matchArgvToOperation<T extends ShapeMatchOperation>(
  operations: T[],
  commandArgv: string[],
): { operation: T, bindings: Record<string, string> } | null {
  let matches = tryMatch(operations, commandArgv)
  if (matches.length === 0) {
    const expanded = expandCombinedFlags(commandArgv)
    if (expanded.length !== commandArgv.length) {
      matches = tryMatch(operations, expanded)
    }
  }
  if (matches.length === 0) return null
  if (matches.length > 1) {
    matches.sort((a, b) => b.operation.command.length - a.operation.command.length)
    matches = [matches[0]!]
  }
  return matches[0]!
}

/**
 * Build the `openape_cli` authorization detail for a matched operation,
 * rendering its resource chain + display from the bindings and setting the
 * canonical permission string.
 */
export function buildCliAuthDetail(
  cliId: string,
  operation: ShapeMatchOperation,
  bindings: Record<string, string>,
): OpenApeCliAuthorizationDetail {
  const resource_chain = parseResourceChain(operation.resource_chain, bindings)
  const detail: OpenApeCliAuthorizationDetail = {
    type: 'openape_cli',
    cli_id: cliId,
    operation_id: operation.id,
    resource_chain,
    action: operation.action,
    permission: '',
    display: renderTemplate(operation.display, bindings),
    risk: operation.risk,
    ...(operation.exact_command ? { constraints: { exact_command: true } } : {}),
  }
  detail.permission = canonicalizeCliPermission(detail)
  return detail
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @openape/grants test -- shape-matcher`
Expected: PASS (all cases in the file).

- [ ] **Step 5: Export from the package index**

In `packages/grants/src/index.ts`, add:

```ts
export { buildCliAuthDetail, matchArgvToOperation, type ShapeMatchOperation } from './shape-matcher.js'
```

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @openape/grants typecheck && pnpm --filter @openape/grants test`
Expected: exit 0.

```bash
git add packages/grants/src/shape-matcher.ts packages/grants/src/__tests__/shape-matcher.test.ts packages/grants/src/index.ts
git commit -m "feat(grants): extract shared shape-matcher (argv→operation + auth detail)"
```

---

## Task 2: Refactor `server-resolver.ts` to use the shared matcher

**Files:**
- Modify: `packages/grants/src/server-resolver.ts`

- [ ] **Step 1: Replace helpers + matching with the shared module**

In `packages/grants/src/server-resolver.ts`:
- Change the imports at the top to:
  ```ts
  import { createHash } from 'node:crypto'
  import type { OpenApeCliAuthorizationDetail } from '@openape/core'
  import { canonicalizeCliPermission, computeArgvHash } from './cli-permissions.js'
  import { buildCliAuthDetail, matchArgvToOperation } from './shape-matcher.js'
  import type { ServerShape, ShapeStore } from './shape-registry.js'
  ```
  (`OpenApeCliResourceRef` and `ServerShapeOperation` are no longer needed here; `canonicalizeCliPermission` stays only for `buildGenericResolvedServer`.)
- DELETE these now-shared functions from this file: `parseOptionArgs`, `resolveBindingToken`, `renderTemplate`, `parseResourceChain`, `matchOperation`, `expandCombinedFlags`, `tryMatch`.
- Replace the body of `tryMatchShape` so it uses the shared matcher + detail builder. New `tryMatchShape`:
  ```ts
  async function tryMatchShape(
    shape: ServerShape,
    fullArgv: string[],
  ): Promise<ServerResolvedCommand | null> {
    const [executable, ...commandArgv] = fullArgv
    if (!executable) return null

    // Server resolver is lenient about executable mismatch (client already
    // verified). Just match against the shape's operations.
    const match = matchArgvToOperation(shape.operations, commandArgv)
    if (!match) return null
    const { operation, bindings } = match

    const detail = buildCliAuthDetail(shape.cli_id, operation, bindings)

    return {
      cli_id: shape.cli_id,
      operation_id: operation.id,
      executable,
      commandArgv,
      bindings,
      detail,
      executionContext: {
        argv: fullArgv,
        argv_hash: await computeArgvHash(fullArgv),
        adapter_id: shape.cli_id,
        adapter_version: 'server',
        adapter_digest: shape.digest,
        resolved_executable: executable,
        context_bindings: bindings,
      },
      permission: detail.permission,
      synthetic: false,
    }
  }
  ```
- Keep `resolveServerShape`, `buildGenericResolvedServer`, `GENERIC_OPERATION_ID`, the `ServerResolvedCommand` interface, and the `createHash`/`canonicalizeCliPermission` usage inside `buildGenericResolvedServer` unchanged.

- [ ] **Step 2: Run server-resolver tests (regression — behavior must be identical)**

Run: `pnpm --filter @openape/grants test -- server-resolver`
Expected: PASS — all existing server-resolver tests green (proves the wrapper produces identical output).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @openape/grants typecheck`
Expected: exit 0. (If TS complains that `ServerShapeOperation[]` isn't assignable to the matcher's generic, it means a field diverged — STOP and report; per the spec they should match.)

- [ ] **Step 4: Commit**

```bash
git add packages/grants/src/server-resolver.ts
git commit -m "refactor(grants): server-resolver uses shared shape-matcher"
```

---

## Task 3: Refactor apes `parser.ts` to use the shared matcher

**Files:**
- Modify: `packages/apes/src/shapes/parser.ts`

- [ ] **Step 1: Replace helpers + matching with the shared module**

In `packages/apes/src/shapes/parser.ts`:
- Change the top imports to:
  ```ts
  import { buildCliAuthDetail, canonicalizeCliPermission, computeArgvHash, matchArgvToOperation } from '@openape/grants'
  import type { LoadedAdapter, ResolvedCommand } from './types.js'
  ```
  (`canonicalizeCliPermission` may now be unused — if so, drop it; `OpenApeCliAuthorizationDetail`/`OpenApeCliResourceRef`/`ShapesOperation` imports are no longer needed here.)
- DELETE these functions from this file: `parseOptionArgs`, `resolveBindingToken`, `renderTemplate`, `parseResourceChain`, `matchOperation`, `expandCombinedFlags`, `tryMatch`.
- Replace `resolveCommand` body to use the shared matcher while preserving the executable check + throw-on-no-match:
  ```ts
  export async function resolveCommand(loaded: LoadedAdapter, fullArgv: string[]): Promise<ResolvedCommand> {
    const [executable, ...commandArgv] = fullArgv
    if (!executable) {
      throw new Error('Missing wrapped command')
    }
    if (executable !== loaded.adapter.cli.executable) {
      throw new Error(`Adapter ${loaded.adapter.cli.id} expects executable ${loaded.adapter.cli.executable}, got ${executable}`)
    }

    const match = matchArgvToOperation(loaded.adapter.operations, commandArgv)
    if (!match) {
      throw new Error(`No adapter operation matched: ${fullArgv.join(' ')}`)
    }
    const { operation, bindings } = match

    const detail = buildCliAuthDetail(loaded.adapter.cli.id, operation, bindings)

    return {
      adapter: loaded.adapter,
      source: loaded.source,
      digest: loaded.digest,
      executable,
      commandArgv,
      bindings,
      detail,
      executionContext: {
        argv: fullArgv,
        argv_hash: await computeArgvHash(fullArgv),
        adapter_id: loaded.adapter.cli.id,
        adapter_version: loaded.adapter.cli.version ?? loaded.adapter.schema,
        adapter_digest: loaded.digest,
        resolved_executable: executable,
        context_bindings: bindings,
      },
      permission: detail.permission,
    }
  }
  ```

- [ ] **Step 2: Run parser tests (regression — behavior must be identical)**

Run: `pnpm --filter @openape/apes test -- parser`
Expected: PASS — all existing parser tests green.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @openape/apes typecheck`
Expected: exit 0. (If `loaded.adapter.operations` (`ShapesOperation[]`) isn't assignable to the matcher generic → a field diverged; STOP and report.)

- [ ] **Step 4: Commit**

```bash
git add packages/apes/src/shapes/parser.ts
git commit -m "refactor(apes): parser uses shared @openape/grants shape-matcher"
```

---

## Task 4: Changeset + full gate

**Files:**
- Create: `.changeset/shape-matcher-extraction.md`

- [ ] **Step 1: Add the changeset**

Create `.changeset/shape-matcher-extraction.md`:

```markdown
---
"@openape/grants": minor
---

Add a shared `shape-matcher` module (`matchArgvToOperation`, `buildCliAuthDetail`, `ShapeMatchOperation`) and route both the server-side shape resolver and apes' client-side command parser through it, removing ~150 lines of duplicated argv-matching logic. Behaviour is unchanged.
```

- [ ] **Step 2: Run the full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: exit 0, all tasks successful (incl. the new shape-matcher tests + the unchanged server-resolver/parser suites). If e2e fails with `EADDRINUSE :::3000`, a stray dev server holds the port — `lsof -ti :3000 | xargs kill` then re-run.

- [ ] **Step 3: Commit**

```bash
git add .changeset/shape-matcher-extraction.md
git commit -m "chore: changeset for grants shape-matcher extraction"
```

---

## Definition of Done

- `packages/grants/src/shape-matcher.ts` exists with `matchArgvToOperation` + `buildCliAuthDetail` + `ShapeMatchOperation`, exported from the grants index, with passing unit tests.
- `server-resolver.ts` and `apes/shapes/parser.ts` contain NO copies of `parseOptionArgs`/`matchOperation`/`parseResourceChain`/`renderTemplate`/`resolveBindingToken`/`expandCombinedFlags`/`tryMatch` (grep both files — only the shared module defines them).
- All existing server-resolver + parser tests pass unchanged (behavior preserved).
- Full gate green; `@openape/grants` minor changeset present.
- Net ~150 duplicated lines removed.
