import type { OpenApeCliAuthorizationDetail, OpenApeCliResourceRef } from '@openape/core'
import { canonicalizeCliPermission, computeArgvHash } from '@openape/grants'
import type { LoadedAdapter, ResolvedCommand, ShapesOperation } from './types.js'

function parseOptionArgs(tokens: string[], valueOptions?: string[]): { options: Record<string, string>, positionals: string[] } {
  const options: Record<string, string> = {}
  const positionals: string[] = []
  const takesValue = new Set(valueOptions ?? [])

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!

    if (token.startsWith('--')) {
      // Long option: --name value or --name=value
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
      // Short option: -name value, -f value, or -l (boolean)
      const key = token.slice(1)

      if (key.length === 1 && !takesValue.has(key)) {
        // Single-char flag not in required_options → boolean
        options[key] = 'true'
      }
      else {
        // Multi-char option (-name) or known value option (-f) → consume next as value
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
  if (!match)
    return binding

  const [, name, transform] = match
  const value = bindings[name]
  if (!value)
    throw new Error(`Missing binding: ${name}`)
  if (!transform)
    return value

  if (transform === 'owner' || transform === 'name') {
    const [owner, repo] = value.split('/')
    if (!owner || !repo)
      throw new Error(`Binding ${name} must be in owner/name form`)
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
    if (!resource)
      throw new Error(`Invalid resource chain entry: ${entry}`)

    if (selectorSpec === '*') {
      return { resource }
    }

    const selector = Object.fromEntries(
      selectorSpec.split(',').map((segment) => {
        const [key, rawValue] = segment.split('=', 2)
        if (!key || !rawValue)
          throw new Error(`Invalid selector segment: ${segment}`)
        return [key, renderTemplate(rawValue, bindings)]
      }),
    )

    return { resource, selector }
  })
}

function matchOperation(operation: ShapesOperation, argv: string[]): Record<string, string> | null {
  if (argv.length < operation.command.length)
    return null

  const prefix = argv.slice(0, operation.command.length)
  if (prefix.join('\0') !== operation.command.join('\0'))
    return null

  const remainder = argv.slice(operation.command.length)
  const { options, positionals } = parseOptionArgs(remainder, operation.required_options)

  const expectedPositionals = operation.positionals ?? []
  if (positionals.length !== expectedPositionals.length)
    return null

  for (const option of operation.required_options ?? []) {
    if (!options[option])
      return null
  }

  const bindings: Record<string, string> = { ...options }
  expectedPositionals.forEach((name, index) => {
    bindings[name] = positionals[index]!
  })
  return bindings
}

function expandCombinedFlags(argv: string[]): string[] {
  return argv.flatMap((token) => {
    // Expand -rl into -r, -l (only single-letter combined flags)
    if (token.startsWith('-') && !token.startsWith('--') && token.length > 2 && /^-[a-z]+$/i.test(token)) {
      return Array.from(token.slice(1), c => `-${c}`)
    }
    return [token]
  })
}

function tryMatch(operations: ShapesOperation[], argv: string[]) {
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

export async function resolveCommand(loaded: LoadedAdapter, fullArgv: string[]): Promise<ResolvedCommand> {
  const [executable, ...commandArgv] = fullArgv
  if (!executable) {
    throw new Error('Missing wrapped command')
  }
  if (executable !== loaded.adapter.cli.executable) {
    throw new Error(`Adapter ${loaded.adapter.cli.id} expects executable ${loaded.adapter.cli.executable}, got ${executable}`)
  }

  // Pass 1: exact match
  let matches = tryMatch(loaded.adapter.operations, commandArgv)

  // Pass 2: try with expanded combined flags (e.g. -rl → -r -l)
  if (matches.length === 0) {
    const expanded = expandCombinedFlags(commandArgv)
    if (expanded.length !== commandArgv.length) {
      matches = tryMatch(loaded.adapter.operations, expanded)
    }
  }

  if (matches.length === 0) {
    throw new Error(`No adapter operation matched: ${fullArgv.join(' ')}`)
  }
  if (matches.length > 1) {
    // Prefer the most specific match (longest command prefix)
    matches.sort((a, b) => b.operation.command.length - a.operation.command.length)
    matches = [matches[0]!]
  }

  const { operation, bindings } = matches[0]!
  const resource_chain = parseResourceChain(operation.resource_chain, bindings)
  const detail: OpenApeCliAuthorizationDetail = {
    type: 'openape_cli',
    cli_id: loaded.adapter.cli.id,
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
