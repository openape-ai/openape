import { parseShapeCliVersions, parseShapePresentation, presentationBindings } from '@openape/grants'
import { parse } from 'smol-toml'
import type { ShapesAdapter, ShapesOperation } from './types.js'

type Raw = Record<string, unknown>

const ROOT_KEYS = ['schema', 'cli', 'operation']
const CLI_KEYS = ['id', 'executable', 'audience', 'version', 'global_options', 'tested_versions', 'version_command', 'version_pattern', 'tested_digests']
const OPERATION_KEYS = ['id', 'command', 'positionals', 'required_options', 'value_options', 'flag_options', 'display', 'action', 'risk', 'resource_chain', 'exact_command', 'decision', 'presentation']
const RISKS = ['low', 'medium', 'high', 'critical']
const OPTION_NAME = /^[\w-]+$/
const GLOBAL_OPTION = /^[\w-]+(?:=[\w-]+)?$/
const FILE_DIGEST = /^SHA-256:[a-f0-9]{64}$/

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Unknown keys fail closed: an adapter must never carry rules this parser would silently drop.
function assertKnownKeys(value: Raw, allowed: string[], owner: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknown.length)
    throw new Error(`${owner} has unknown key(s): ${unknown.join(', ')}`)
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(token => typeof token === 'string')
}

/**
 * The original line-based parser split every array string at commas, and
 * stored grants carry permissions derived that way, so matching fields keep
 * that reading. A selector with two keys (`repo:owner={o},name={n}`) therefore
 * cannot be written; the matcher rejects the template resource it leaves
 * (`name={n}`) instead of granting every repository of the owner.
 */
function legacyList(value: string[]): string[] {
  return value.flatMap(entry => entry.split(',').map(part => part.trim()))
}

function optionalStringList(value: unknown, field: string, owner: string): string[] | undefined {
  if (value === undefined)
    return undefined
  if (!isStringList(value))
    throw new Error(`${owner} has an invalid ${field}[]`)
  return legacyList(value)
}

function optionalOptionList(value: unknown, field: string, owner: string, pattern: RegExp): string[] | undefined {
  const list = optionalStringList(value, field, owner)
  if (list?.some(entry => !pattern.test(entry)))
    throw new Error(`${owner} has an invalid ${field}[]`)
  return list
}

/** `[cli] tested_digests`: file digests of executables the operations were checked against (issue 1473). */
function parseTestedDigests(value: unknown): string[] | undefined {
  if (value === undefined)
    return undefined
  if (!isStringList(value) || value.length === 0 || value.length > 64 || value.some(entry => !FILE_DIGEST.test(entry)) || new Set(value).size !== value.length)
    throw new Error('Adapter cli tested_digests must list distinct SHA-256:<hex> file digests')
  return [...value]
}

function parseOperation(operation: unknown, globalOptions: string[] | undefined): ShapesOperation {
  if (!isRecord(operation))
    throw new Error('Adapter [[operation]] entries must be tables')
  const owner = `Operation ${typeof operation.id === 'string' ? operation.id : '<unknown>'}`
  assertKnownKeys(operation, OPERATION_KEYS, owner)
  if (!isStringList(operation.command))
    throw new Error(`${owner} is missing command[]`)
  if (!isStringList(operation.resource_chain))
    throw new Error(`${owner} is missing resource_chain[]`)
  if (typeof operation.id !== 'string' || typeof operation.display !== 'string' || typeof operation.action !== 'string')
    throw new TypeError('Operation must define id, display, and action')
  if (operation.risk !== undefined && !RISKS.includes(operation.risk as string))
    throw new Error(`${owner} has an invalid risk`)
  if (operation.exact_command !== undefined && typeof operation.exact_command !== 'boolean')
    throw new Error(`${owner} has an invalid exact_command`)

  if (operation.decision !== undefined && operation.decision !== 'once' && operation.decision !== 'deny')
    throw new Error(`${owner} has an invalid decision policy`)
  if (operation.decision === 'once' && operation.exact_command !== true)
    throw new Error(`${owner} requires exact_command for a single-use decision`)

  const parsed: ShapesOperation = {
    id: operation.id,
    command: legacyList(operation.command),
    ...(operation.positionals === undefined ? {} : { positionals: optionalStringList(operation.positionals, 'positionals', owner) }),
    ...(operation.required_options === undefined ? {} : { required_options: optionalStringList(operation.required_options, 'required_options', owner) }),
    ...(operation.value_options === undefined ? {} : { value_options: optionalOptionList(operation.value_options, 'value_options', owner, OPTION_NAME) }),
    ...(operation.flag_options === undefined ? {} : { flag_options: optionalOptionList(operation.flag_options, 'flag_options', owner, OPTION_NAME) }),
    // Global options are declared once on [cli] and apply to every operation.
    ...(globalOptions?.length ? { global_options: globalOptions } : {}),
    display: operation.display,
    action: operation.action,
    risk: (operation.risk as ShapesOperation['risk'] | undefined) ?? 'low',
    resource_chain: legacyList(operation.resource_chain),
    ...(operation.decision === undefined ? {} : { decision: operation.decision as 'once' | 'deny' }),
    ...(operation.exact_command === undefined ? {} : { exact_command: operation.exact_command }),
  }
  if (operation.presentation !== undefined)
    parsed.presentation = parseShapePresentation(operation.presentation, owner, presentationBindings(parsed))
  return parsed
}

export function parseAdapterToml(content: string): ShapesAdapter {
  const file = parse(content) as Raw
  assertKnownKeys(file, ROOT_KEYS, 'Adapter')

  if (file.schema !== 'openape-shapes/v1')
    throw new Error(`Unsupported adapter schema: ${typeof file.schema === 'string' ? file.schema : 'missing'}`)
  const cli = file.cli
  if (!isRecord(cli) || !cli.id || !cli.executable)
    throw new Error('Adapter is missing cli.id or cli.executable')
  assertKnownKeys(cli, CLI_KEYS, 'Adapter cli')
  if (!Array.isArray(file.operation) || file.operation.length === 0)
    throw new Error('Adapter must define at least one [[operation]] entry')

  const globalOptions = optionalOptionList(cli.global_options, 'global_options', 'Adapter cli', GLOBAL_OPTION)
  const versions = parseShapeCliVersions(cli, 'Adapter cli')
  const digests = parseTestedDigests(cli.tested_digests)

  return {
    schema: file.schema,
    cli: {
      id: String(cli.id),
      executable: String(cli.executable),
      ...(cli.audience ? { audience: String(cli.audience) } : {}),
      ...(cli.version ? { version: String(cli.version) } : {}),
      ...versions,
      ...(digests ? { tested_digests: digests } : {}),
    },
    operations: file.operation.map(operation => parseOperation(operation, globalOptions)),
  }
}
