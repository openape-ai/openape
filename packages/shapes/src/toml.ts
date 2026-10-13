import type { ShapesAdapter, ShapesOperation } from './types.js'

interface AdapterTomlFile {
  schema?: string
  cli?: ShapesAdapter['cli']
  operation?: ShapesOperation[]
}

function parseKeyValue(line: string): { key: string, value: string } | null {
  const eqIndex = line.indexOf('=')
  if (eqIndex === -1)
    return null
  const key = line.slice(0, eqIndex).trim()
  const value = line.slice(eqIndex + 1).trim()
  if (!key || !value)
    return null
  return { key, value }
}

function parseTomlValue(raw: string): unknown {
  const trimmed = raw.trim()

  if (trimmed.startsWith('"') && trimmed.endsWith('"'))
    return trimmed.slice(1, -1)
  if (trimmed === 'true')
    return true
  if (trimmed === 'false')
    return false
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim()
    if (!inner)
      return []
    return inner.split(',').map(value => value.trim().replace(/^"|"$/g, ''))
  }

  return trimmed
}

const OPTION_NAME = /^[\w-]+$/
const GLOBAL_OPTION = /^[\w-]+(?:=[\w-]+)?$/

function optionalOptionList(value: unknown, field: string, owner: string, pattern: RegExp): string[] | undefined {
  if (value === undefined)
    return undefined
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string' || !pattern.test(entry)))
    throw new Error(`${owner} has an invalid ${field}[]`)
  return value as string[]
}

export function parseAdapterToml(content: string): ShapesAdapter {
  const result: AdapterTomlFile = {}
  const operations: ShapesOperation[] = []
  let currentSection: 'root' | 'cli' | 'operation' = 'root'
  let currentEntry: Record<string, unknown> = {}

  const flushOperation = () => {
    if (currentSection === 'operation' && Object.keys(currentEntry).length > 0) {
      operations.push(currentEntry as unknown as ShapesOperation)
      currentEntry = {}
    }
  }

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#'))
      continue

    if (line === '[cli]') {
      flushOperation()
      currentSection = 'cli'
      result.cli = {} as ShapesAdapter['cli']
      continue
    }

    if (line === '[[operation]]') {
      flushOperation()
      currentSection = 'operation'
      currentEntry = {}
      continue
    }

    const kv = parseKeyValue(line)
    if (!kv)
      continue

    const value = parseTomlValue(kv.value)
    if (currentSection === 'root') {
      ;(result as Record<string, unknown>)[kv.key] = value
    }
    else if (currentSection === 'cli') {
      ;(result.cli as Record<string, unknown>)[kv.key] = value
    }
    else {
      currentEntry[kv.key] = value
    }
  }

  flushOperation()
  result.operation = operations

  if (result.schema !== 'openape-shapes/v1') {
    throw new Error(`Unsupported adapter schema: ${result.schema ?? 'missing'}`)
  }
  if (!result.cli?.id || !result.cli.executable) {
    throw new Error('Adapter is missing cli.id or cli.executable')
  }
  if (!result.operation?.length) {
    throw new Error('Adapter must define at least one [[operation]] entry')
  }

  const globalOptions = optionalOptionList((result.cli as Record<string, unknown>).global_options, 'global_options', 'Adapter cli', GLOBAL_OPTION)

  return {
    schema: result.schema,
    cli: {
      id: String(result.cli.id),
      executable: String(result.cli.executable),
      ...(result.cli.audience ? { audience: String(result.cli.audience) } : {}),
      ...(result.cli.version ? { version: String(result.cli.version) } : {}),
    },
    operations: result.operation.map((operation) => {
      if (!Array.isArray(operation.command) || operation.command.some(token => typeof token !== 'string')) {
        throw new Error(`Operation ${String(operation.id ?? '<unknown>')} is missing command[]`)
      }
      if (!Array.isArray(operation.resource_chain) || operation.resource_chain.some(token => typeof token !== 'string')) {
        throw new Error(`Operation ${String(operation.id ?? '<unknown>')} is missing resource_chain[]`)
      }
      if (typeof operation.id !== 'string' || typeof operation.display !== 'string' || typeof operation.action !== 'string') {
        throw new TypeError('Operation must define id, display, and action')
      }
      const valueOptions = optionalOptionList(operation.value_options, 'value_options', `Operation ${operation.id}`, OPTION_NAME)
      const flagOptions = optionalOptionList(operation.flag_options, 'flag_options', `Operation ${operation.id}`, OPTION_NAME)
      return {
        id: operation.id,
        command: operation.command as string[],
        ...(Array.isArray(operation.positionals) ? { positionals: operation.positionals as string[] } : {}),
        ...(Array.isArray(operation.required_options) ? { required_options: operation.required_options as string[] } : {}),
        ...(valueOptions ? { value_options: valueOptions } : {}),
        ...(flagOptions ? { flag_options: flagOptions } : {}),
        // Global options are declared once on [cli] and apply to every operation.
        ...(globalOptions?.length ? { global_options: globalOptions } : {}),
        display: operation.display,
        action: operation.action,
        risk: (operation.risk as ShapesOperation['risk']) || 'low',
        resource_chain: operation.resource_chain as string[],
        ...(operation.exact_command !== undefined ? { exact_command: Boolean(operation.exact_command) } : {}),
      }
    }),
  }
}
