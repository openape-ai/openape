import { defineCommand } from 'citty'
import { loadAdapter } from '../adapters.js'
import { verifyAndExecute } from '../grants.js'
import { resolveCommand } from '../parser.js'
import { extractOption, extractWrappedCommand } from './explain.js'

export const executeCommand = defineCommand({
  meta: {
    name: 'run',
    description: 'Execute a wrapped command with an existing grant token',
  },
  args: {
    grant: {
      type: 'string',
      description: 'JWT grant token',
      required: true,
    },
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
  async run({ rawArgs, args }) {
    const command = extractWrappedCommand(rawArgs ?? [])
    if (command.length === 0)
      throw new Error('Missing wrapped command. Usage: shapes --grant <jwt> -- <cli> ...')

    const adapterOpt = extractOption(rawArgs ?? [], 'adapter')
    const loaded = loadAdapter(command[0]!, adapterOpt)
    const resolved = await resolveCommand(loaded, command)
    await verifyAndExecute(args.grant, resolved)
  },
})
