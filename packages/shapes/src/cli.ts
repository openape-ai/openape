import consola from 'consola'
import { defineCommand, runMain } from 'citty'
import { adapterCommand } from './commands/adapter.js'
import { explainCommand, extractOption, extractWrappedCommand } from './commands/explain.js'
import { requestCommand } from './commands/request.js'
import { loadAdapter } from './adapters.js'
import { verifyAndExecute } from './grants.js'
import { resolveCommand } from './parser.js'

const main = defineCommand({
  meta: {
    name: 'shapes',
    version: '0.3.0',
    description: 'Grant-aware CLI wrappers for OpenApe',
  },
  subCommands: {
    explain: explainCommand,
    request: requestCommand,
    adapter: adapterCommand,
  },
})

async function executeWithGrant(args: string[]) {
  const grantIndex = args.indexOf('--grant')
  const grant = grantIndex >= 0 ? args[grantIndex + 1] : undefined
  if (!grant)
    throw new Error('Missing --grant <jwt>')

  const command = extractWrappedCommand(args)
  if (command.length === 0)
    throw new Error('Missing wrapped command. Usage: shapes --grant <jwt> [--adapter <file>] -- <cli> ...')

  const adapterOpt = extractOption(args, 'adapter')
  const loaded = loadAdapter(command[0]!, adapterOpt)
  const resolved = await resolveCommand(loaded, command)
  await verifyAndExecute(grant, resolved)
}

async function run() {
  const args = process.argv.slice(2)

  // Legacy mode: shapes --grant <jwt> -- <cli> ...
  // This doesn't fit citty's subcommand model, so handle it directly.
  // Let --help / -h pass through to citty even when --grant is present.
  if (args.includes('--grant') && !args.includes('--help') && !args.includes('-h')) {
    await executeWithGrant(args)
    return
  }

  await runMain(main, { rawArgs: args })
}

run().catch((error) => {
  consola.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
