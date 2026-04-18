import { createHash } from 'node:crypto'
import type { OpenApeCliAuthorizationDetail, OpenApeCliResourceRef } from '@openape/core'
import { canonicalizeCliPermission, computeArgvHash } from './cli-permissions.js'
import type { ServerShape, ServerShapeOperation, ShapeStore } from './shape-registry.js'

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
    return buildGenericResolvedServer(cliId, fullArgv)
  }
  const resolved = await tryMatchShape(shape, fullArgv)
  if (resolved) return resolved
  return buildGenericResolvedServer(cliId, fullArgv)
}

// ---------------------------------------------------------------------------
// Ported helpers (from packages/apes/src/shapes/parser.ts)
// ---------------------------------------------------------------------------

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
  operation: ServerShapeOperation,
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

function tryMatch(
  operations: ServerShapeOperation[],
  argv: string[],
): Array<{ operation: ServerShapeOperation, bindings: Record<string, string> }> {
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

async function tryMatchShape(
  shape: ServerShape,
  fullArgv: string[],
): Promise<ServerResolvedCommand | null> {
  const [executable, ...commandArgv] = fullArgv
  if (!executable) return null

  // Server resolver is lenient about executable mismatch (client already
  // verified). Just proceed with shape's operations.
  let matches = tryMatch(shape.operations, commandArgv)
  if (matches.length === 0) {
    const expanded = expandCombinedFlags(commandArgv)
    if (expanded.length !== commandArgv.length) {
      matches = tryMatch(shape.operations, expanded)
    }
  }
  if (matches.length === 0) return null
  if (matches.length > 1) {
    matches.sort((a, b) => b.operation.command.length - a.operation.command.length)
    matches = [matches[0]!]
  }

  const { operation, bindings } = matches[0]!
  const resource_chain = parseResourceChain(operation.resource_chain, bindings)
  const detail: OpenApeCliAuthorizationDetail = {
    type: 'openape_cli',
    cli_id: shape.cli_id,
    operation_id: operation.id,
    resource_chain,
    action: operation.action,
    permission: '',
    display: renderTemplate(operation.display, bindings),
    risk: operation.risk,
    ...(operation.exact_command ? { constraints: { exact_command: true } } : {}),
  }
  detail.permission = canonicalizeCliPermission(detail)

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

function buildGenericResolvedServer(cliId: string, fullArgv: string[]): ServerResolvedCommand {
  const executable = fullArgv[0]!
  const commandArgv = fullArgv.slice(1)
  const argvHash = `SHA-256:${createHash('sha256').update(fullArgv.join('\u0000')).digest('hex')}`
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
