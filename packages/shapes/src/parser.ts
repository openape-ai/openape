import { canonicalizeCliPermission, computeArgvHash } from '@openape/core'
import type { OpenApeCliAuthorizationDetail, OpenApeCliResourceRef } from '@openape/core'
import type { LoadedAdapter, ResolvedCommand, ShapesOperation } from './types.js'

function parseOptionArgs(tokens: string[]): { options: Record<string, string>, positionals: string[] } {
  const options: Record<string, string> = {}
  const positionals: string[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }

    const stripped = token.slice(2)
    const eqIndex = stripped.indexOf('=')
    if (eqIndex >= 0) {
      options[stripped.slice(0, eqIndex)] = stripped.slice(eqIndex + 1)
      continue
    }

    const next = tokens[index + 1]
    if (next && !next.startsWith('--')) {
      options[stripped] = next
      index += 1
      continue
    }

    options[stripped] = 'true'
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
  const { options, positionals } = parseOptionArgs(remainder)

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

export async function resolveCommand(loaded: LoadedAdapter, fullArgv: string[]): Promise<ResolvedCommand> {
  const [executable, ...commandArgv] = fullArgv
  if (!executable) {
    throw new Error('Missing wrapped command')
  }
  if (executable !== loaded.adapter.cli.executable) {
    throw new Error(`Adapter ${loaded.adapter.cli.id} expects executable ${loaded.adapter.cli.executable}, got ${executable}`)
  }

  const matches = loaded.adapter.operations.flatMap((operation) => {
    try {
      const bindings = matchOperation(operation, commandArgv)
      return bindings ? [{ operation, bindings }] : []
    }
    catch {
      return []
    }
  })

  if (matches.length === 0) {
    throw new Error(`No adapter operation matched: ${fullArgv.join(' ')}`)
  }
  if (matches.length > 1) {
    throw new Error(`Ambiguous adapter match for command: ${fullArgv.join(' ')}`)
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
