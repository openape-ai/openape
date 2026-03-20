import { defineCommand } from 'citty'
import { loadAdapter } from '../adapters.js'
import { resolveCommand } from '../parser.js'

export const explainCommand = defineCommand({
  meta: {
    name: 'explain',
    description: 'Show what permission a wrapped command would need',
  },
  args: {
    adapter: {
      type: 'string',
      description: 'Explicit path to adapter TOML file',
    },
    _: {
      type: 'positional',
      description: 'Wrapped command (after --)',
      required: false,
    },
  },
  async run({ rawArgs }) {
    const command = extractWrappedCommand(rawArgs ?? [])
    if (command.length === 0)
      throw new Error('Missing wrapped command. Usage: shapes explain [--adapter <file>] -- <cli> ...')

    const adapterOpt = extractOption(rawArgs ?? [], 'adapter')
    const loaded = loadAdapter(command[0]!, adapterOpt)
    const resolved = await resolveCommand(loaded, command)

    process.stdout.write(`${JSON.stringify({
      adapter: resolved.adapter.cli.id,
      source: resolved.source,
      operation: resolved.detail.operation_id,
      display: resolved.detail.display,
      permission: resolved.permission,
      resource_chain: resolved.detail.resource_chain,
      exact_command: resolved.detail.constraints?.exact_command ?? false,
      adapter_digest: resolved.digest,
    }, null, 2)}\n`)
  },
})

export function extractWrappedCommand(args: string[]): string[] {
  const delimiter = args.indexOf('--')
  return delimiter >= 0 ? args.slice(delimiter + 1) : []
}

export function extractOption(args: string[], name: string): string | undefined {
  const delimiter = args.indexOf('--')
  const optionArgs = delimiter >= 0 ? args.slice(0, delimiter) : args
  const index = optionArgs.indexOf(`--${name}`)
  if (index >= 0 && index + 1 < optionArgs.length)
    return optionArgs[index + 1]
  return undefined
}
