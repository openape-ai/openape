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
