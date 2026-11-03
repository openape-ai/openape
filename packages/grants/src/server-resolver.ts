import type { OpenApeCliAuthorizationDetail } from '@openape/core'
import { canonicalizeCliPermission, computeArgvHash } from './cli-permissions.js'
import { buildCliAuthDetail, matchArgvToOperation } from './shape-matcher.js'
import type { ServerShape, ShapeStore } from './shape-registry.js'

/**
 * The synthetic operation id used when no registered shape matches the
 * incoming argv. Mirrors the client-side constant in
 * `packages/apes/src/shapes/generic.ts`. When the IdP becomes the sole
 * resolver (Phase 3), this is the only fallback path for unshaped CLIs.
 */
export const GENERIC_OPERATION_ID = '_generic.exec'

/** Result of server-side shape resolution — shape-compatible with the client `ResolvedCommand`. */
export interface ServerResolvedCommand {
  cli_id: string
  operation_id: string
  executable: string
  commandArgv: string[]
  bindings: Record<string, string>
  detail: OpenApeCliAuthorizationDetail
  executionContext: {
    argv: string[]
    argv_hash: string
    adapter_id: string
    adapter_version: string
    adapter_digest: string
    /** The account whose own shape resolved the command; absent for registry shapes and the generic fallback. */
    adapter_owner?: string
    /** The email domain whose domain shape resolved the command; absent otherwise. */
    adapter_domain?: string
    resolved_executable: string
    context_bindings: Record<string, string>
  }
  permission: string
  /** True when no shape matched and the generic fallback was produced. */
  synthetic: boolean
}

/**
 * Server-side port of `packages/apes/src/shapes/parser.ts resolveCommand()`.
 * Looks up the shape for `cli_id` in the store, runs argv-matching against
 * its operations, and returns a structured authorization detail. When no
 * shape is found OR no operation matches, falls back to a generic
 * high-risk exact-command grant (same semantics as
 * `packages/apes/src/shapes/generic.ts:buildGenericResolved`).
 *
 * Pure logic — no DB writes, no HTTP calls, safe to call from any handler.
 */
export async function resolveServerShape(
  store: ShapeStore,
  cliId: string,
  fullArgv: string[],
): Promise<ServerResolvedCommand> {
  if (fullArgv.length === 0)
    throw new Error('resolveServerShape: fullArgv must include the executable')

  const shape = await store.getShape(cliId)
  if (!shape) {
    return await buildGenericResolvedServer(cliId, fullArgv)
  }
  const resolved = await tryMatchShape(shape, fullArgv)
  if (resolved) return resolved
  return await buildGenericResolvedServer(cliId, fullArgv)
}

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
      ...(shape.owner ? { adapter_owner: shape.owner } : {}),
      ...(shape.domain ? { adapter_domain: shape.domain } : {}),
      resolved_executable: executable,
      context_bindings: bindings,
    },
    permission: detail.permission,
    synthetic: false,
  }
}

/**
 * The exact-command detail for an argv no shape describes: high risk, bound to
 * the argv hash (`computeArgvHash`, the same hash apes binds client-side).
 */
export async function buildGenericResolvedServer(cliId: string, fullArgv: string[]): Promise<ServerResolvedCommand> {
  if (fullArgv.length === 0)
    throw new Error('buildGenericResolvedServer: fullArgv must include the executable')
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

  return {
    cli_id: cliId,
    operation_id: GENERIC_OPERATION_ID,
    executable,
    commandArgv,
    bindings: {},
    detail,
    executionContext: {
      argv: fullArgv,
      argv_hash: argvHash,
      adapter_id: cliId,
      adapter_version: 'openape-shapes/v1',
      adapter_digest: 'synthetic',
      resolved_executable: executable,
      context_bindings: {},
    },
    permission: detail.permission,
    synthetic: true,
  }
}
