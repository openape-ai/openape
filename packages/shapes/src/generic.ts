import type { OpenApeCliAuthorizationDetail } from '@openape/core'
import { canonicalizeCliPermission, computeArgvHash } from '@openape/grants'
import type { LoadedAdapter, ResolvedCommand, ShapesAdapter } from './types.js'

/**
 * The synthetic operation ID used for generic-fallback grants. Downstream
 * code (audit logging, UI banner) keys off this exact string.
 */
export const GENERIC_OPERATION_ID = '_generic.exec'

/**
 * Schema version for synthetic adapters. Not persisted anywhere — exists
 * only so the in-memory adapter shape matches `ShapesAdapter`.
 */
const SYNTHETIC_SCHEMA = 'openape-shapes/v1'

/**
 * Build a synthetic in-memory `LoadedAdapter` for a CLI that has no
 * registered shape. The adapter is marked with `synthetic: true` so
 * callers can branch on it if needed.
 *
 * NOTE: This does NOT produce a parser-matchable adapter. The generic
 * pipeline bypasses `resolveCommand()` entirely — see `buildGenericResolved()`.
 * This function exists for flow-control markers and tests.
 */
export function buildGenericAdapter(cliId: string): LoadedAdapter {
  const adapter: ShapesAdapter = {
    schema: SYNTHETIC_SCHEMA,
    cli: {
      id: cliId,
      executable: cliId,
      audience: 'shapes',
      version: 'synthetic',
    },
    operations: [],
  }
  return {
    adapter,
    source: '<synthetic>',
    digest: 'synthetic',
    synthetic: true,
  }
}

/**
 * Build a `ResolvedCommand` directly for a CLI that has no registered shape.
 *
 * Unlike the normal flow (loadAdapter → resolveCommand), the generic path
 * bypasses the parser entirely. Rationale:
 *
 *   - `resolveCommand()` matches argv against declarative operation specs
 *     via `matchOperation()`, which requires `positionals.length ===
 *     operation.positionals.length`. A "match-all" spec (`command: []`,
 *     `positionals: []`) would reject any non-empty argv.
 *
 *   - Synthetic adapters have no declarative spec — we already know what
 *     to execute. Running the parser is theatre.
 *
 * The returned `ResolvedCommand` has:
 *   - `detail.operation_id === GENERIC_OPERATION_ID` — marker consumed by
 *     the audit-log hook in `verifyAndExecute`.
 *   - `detail.risk === 'high'` — forced.
 *   - `detail.constraints.exact_command === true` — forced, binds the
 *     grant to this exact argv via `argv_hash`.
 *   - `resource_chain = [{resource: 'cli', selector: {name: cliId}},
 *                        {resource: 'argv', selector: {hash: <sha256>}}]`
 */
export async function buildGenericResolved(
  cliId: string,
  fullArgv: string[],
): Promise<ResolvedCommand> {
  if (fullArgv.length === 0)
    throw new Error('buildGenericResolved: fullArgv must include the executable')
  const executable = fullArgv[0]!
  const commandArgv = fullArgv.slice(1)
  const argvHash = await computeArgvHash(fullArgv)

  const display = `Execute (unshaped): \`${cliId} ${commandArgv.join(' ')}\``

  const detail: OpenApeCliAuthorizationDetail = {
    type: 'openape_cli',
    cli_id: cliId,
    operation_id: GENERIC_OPERATION_ID,
    resource_chain: [
      { resource: 'cli', selector: { name: cliId } },
      { resource: 'argv', selector: { hash: argvHash } },
    ],
    action: 'exec',
    permission: '',
    display,
    risk: 'high',
    constraints: { exact_command: true },
  }
  detail.permission = canonicalizeCliPermission(detail)

  const adapter = buildGenericAdapter(cliId)

  return {
    adapter: adapter.adapter,
    source: adapter.source,
    digest: adapter.digest,
    executable,
    commandArgv,
    bindings: {},
    detail,
    executionContext: {
      argv: fullArgv,
      argv_hash: argvHash,
      adapter_id: cliId,
      adapter_version: SYNTHETIC_SCHEMA,
      adapter_digest: adapter.digest,
      resolved_executable: executable,
      context_bindings: {},
    },
    permission: detail.permission,
  }
}

/**
 * Type guard: does this `ResolvedCommand` come from the generic fallback path?
 */
export function isGenericResolved(resolved: ResolvedCommand): boolean {
  return resolved.detail.operation_id === GENERIC_OPERATION_ID
}
