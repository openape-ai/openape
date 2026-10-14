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
  /**
   * Options that take a value. When this or `flag_options` is present (even
   * empty), only declared options are accepted: these and `required_options`
   * bind the following token, `flag_options` are flags, and any other option
   * makes the operation not match.
   */
  value_options?: string[]
  /** Options accepted as flags once options are declared (see `value_options`). */
  flag_options?: string[]
  /**
   * Adapter-wide options accepted before the command prefix, as `name` or
   * `name=binding` (e.g. `C=repo` for git `-C <path>`). Each takes a value.
   * Adapter parsers copy `[cli] global_options` onto every operation.
   */
  global_options?: string[]
  display: string
  action: string
  risk: ScopeRiskLevel
  resource_chain: string[]
  exact_command?: boolean
}

function optionName(token: string): string | null {
  if (token.startsWith('--')) return token.slice(2)
  if (token.startsWith('-') && token.length > 1 && !/^-\d/.test(token)) return token.slice(1)
  return null
}

function splitInlineValue(token: string, name: string): { key: string, value?: string } {
  const eqIndex = token.startsWith('--') ? name.indexOf('=') : -1
  if (eqIndex < 0) return { key: name }
  return { key: name.slice(0, eqIndex), value: name.slice(eqIndex + 1) }
}

function declaresOptions(operation: Pick<ShapeMatchOperation, 'value_options' | 'flag_options'>): boolean {
  return operation.value_options !== undefined || operation.flag_options !== undefined
}

/**
 * Reads one option token in its exact dash form: `--name` or `--name=value`
 * for names longer than one character, exactly `-x` for one-letter names.
 * Returns null for any other spelling (`--C`, `-Cfoo`, `-porcelain`, `-n5`).
 */
function exactOption(token: string): { key: string, value?: string } | null {
  if (token.startsWith('--')) {
    const { key, value } = splitInlineValue(token, token.slice(2))
    return key.length > 1 ? { key, ...(value === undefined ? {} : { value }) } : null
  }
  return token.length === 2 ? { key: token[1]! } : null
}

/**
 * Declared-only parsing: every option must be declared and spelled in its
 * exact dash form, and a single-dash bundle such as `-ab` is accepted only
 * when every letter is a declared one-letter flag. Fails closed otherwise, so
 * an option the real CLI reads as a command (git `--upload-pack`, `-c`,
 * `--exec`) never passes as a flag.
 */
function parseDeclaredOptionArgs(
  tokens: string[],
  operation: Pick<ShapeMatchOperation, 'required_options' | 'value_options' | 'flag_options'>,
): { options: Record<string, string>, positionals: string[] } | null {
  const options: Record<string, string> = {}
  const positionals: string[] = []
  const takesValue = new Set([...(operation.required_options ?? []), ...(operation.value_options ?? [])])
  const flags = new Set(operation.flag_options ?? [])

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (!token.startsWith('-') || token === '-') {
      positionals.push(token)
      continue
    }
    const bundle = !token.startsWith('--') && token.length > 2 ? Array.from(token.slice(1)) : null
    if (bundle) {
      if (!bundle.every(letter => flags.has(letter))) return null
      for (const letter of bundle) options[letter] = 'true'
      continue
    }
    const option = exactOption(token)
    if (!option) return null
    const { key, value } = option
    if (takesValue.has(key)) {
      if (value !== undefined) {
        options[key] = value
        continue
      }
      const next = tokens[index + 1]
      if (!next || next.startsWith('-')) return null
      options[key] = next
      index += 1
      continue
    }
    if (!flags.has(key)) return null
    options[key] = value ?? 'true'
  }
  return { options, positionals }
}

/**
 * Splits option tokens from positionals. Returns null when an option is not
 * allowed for the operation.
 *
 * Operations without `value_options` and `flag_options` keep the original
 * rule, so permissions derived for existing adapters stay identical: `--name`
 * and multi-letter `-name` consume the next non-dash token, single-letter `-x`
 * only when listed in `required_options`.
 *
 * Operations that declare `value_options` or `flag_options` (even empty
 * lists) accept only declared options (see `parseDeclaredOptionArgs`):
 * `value_options` and `required_options` bind the next token, `flag_options`
 * are flags, so `merge-base --is-ancestor A B` keeps `A` and `B` as
 * positionals.
 */
function parseOptionArgs(
  tokens: string[],
  operation: Pick<ShapeMatchOperation, 'required_options' | 'value_options' | 'flag_options'>,
): { options: Record<string, string>, positionals: string[] } | null {
  if (declaresOptions(operation)) return parseDeclaredOptionArgs(tokens, operation)
  const options: Record<string, string> = {}
  const positionals: string[] = []
  const takesValue = new Set(operation.required_options ?? [])

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    const name = optionName(token)
    if (name === null) {
      positionals.push(token)
      continue
    }
    const { key, value } = splitInlineValue(token, name)
    if (value !== undefined) {
      options[key] = value
      continue
    }
    const shortOption = !token.startsWith('--') && key.length === 1
    const consumes = shortOption ? takesValue.has(key) : true
    const next = tokens[index + 1]
    if (consumes && next && !next.startsWith('-')) {
      options[key] = next
      index += 1
      continue
    }
    options[key] = 'true'
  }
  return { options, positionals }
}

/**
 * Consumes leading global options (declared adapter-wide, e.g. git
 * `-C <path>`) before the command prefix. Entries are `name` or
 * `name=binding`; every global option takes a value. Stops at the first token
 * that is not a declared global option. Returns null when a declared global
 * option lacks its value or is repeated.
 */
function parseGlobalOptions(
  argv: string[],
  globalOptions: string[],
): { bindings: Record<string, string>, rest: string[] } | null {
  const bindingFor = new Map(globalOptions.map((entry) => {
    const [name, binding] = entry.split('=', 2)
    return [name!, binding || name!]
  }))
  const bindings: Record<string, string> = {}
  let index = 0
  while (index < argv.length) {
    const token = argv[index]!
    if (!token.startsWith('-')) break
    // Exact dash form only: `--C repo` or `-Crepo` never bind as `-C repo`.
    const option = exactOption(token)
    if (!option) break
    const { key, value } = option
    const binding = bindingFor.get(key)
    if (!binding) break
    // The CLI may combine repeated values (git `-C a -C b` → `a/b`); one
    // binding cannot describe that, so a repeated global option never matches.
    if (binding in bindings) return null
    if (value !== undefined) {
      bindings[binding] = value
      index += 1
      continue
    }
    const next = argv[index + 1]
    if (!next || next.startsWith('-')) return null
    bindings[binding] = next
    index += 2
  }
  return { bindings, rest: argv.slice(index) }
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
    // A resource name is never a template: adapter parsers split array strings at commas, so
    // `repo:owner={o},name={n}` would otherwise yield an unbound `name={n}` resource that
    // matches every repository of the owner.
    if (!resource || !/^[\w-]+$/.test(resource)) throw new Error(`Invalid resource chain entry: ${entry}`)
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
  const global = operation.global_options?.length
    ? parseGlobalOptions(argv, operation.global_options)
    : { bindings: {}, rest: argv }
  if (!global) return null
  const commandArgv = global.rest
  if (commandArgv.length < operation.command.length) return null
  const prefix = commandArgv.slice(0, operation.command.length)
  if (prefix.join('\0') !== operation.command.join('\0')) return null
  const remainder = commandArgv.slice(operation.command.length)
  const parsed = parseOptionArgs(remainder, operation)
  if (!parsed) return null
  const { options, positionals } = parsed
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
  // A global binding (e.g. the repository of `git -C`) must never be replaced
  // by an operation option or positional of the same name.
  for (const [name, value] of Object.entries(global.bindings)) {
    if (name in bindings) return null
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
 * operations. Pass 1 exact; pass 2 with combined single-letter flags expanded
 * for operations without declared options (declared operations read bundles
 * themselves and accept them only from declared one-letter flags).
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
      matches = tryMatch(operations.filter(operation => !declaresOptions(operation)), expanded)
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
