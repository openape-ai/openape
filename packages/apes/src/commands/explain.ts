import { defineCommand } from 'citty'
import { extractOption, extractWrappedCommand, loadAdapter, resolveCommand } from '@openape/shapes'

export const explainCommand = defineCommand({
  meta: {
    name: 'explain',
    description: 'Show what permission a command would need',
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
      throw new Error('Missing wrapped command. Usage: apes explain [--adapter <file>] -- <cli> ...')

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
