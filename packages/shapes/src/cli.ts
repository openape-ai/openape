import consola from 'consola'
import { loadAdapter } from './adapters.js'
import { getIdpUrl } from './config.js'
import { fetchGrantToken, createShapesGrant, verifyAndExecute, waitForGrantStatus } from './grants.js'
import { resolveCommand } from './parser.js'

interface ParsedInvocation {
  options: Record<string, string>
  command: string[]
}

function parseInvocation(args: string[]): ParsedInvocation {
  const delimiter = args.indexOf('--')
  const optionArgs = delimiter >= 0 ? args.slice(0, delimiter) : args
  const command = delimiter >= 0 ? args.slice(delimiter + 1) : []
  const options: Record<string, string> = {}

  for (let index = 0; index < optionArgs.length; index += 1) {
    const token = optionArgs[index]!
    if (!token.startsWith('--'))
      continue
    const key = token.slice(2)
    const next = optionArgs[index + 1]
    if (next && !next.startsWith('--')) {
      options[key] = next
      index += 1
    }
    else {
      options[key] = 'true'
    }
  }

  return { options, command }
}

function usage(): string {
  return [
    'shapes explain [--adapter <file>] -- <wrapped-cli> ...',
    'shapes request [--idp <url>] [--approval once|timed|always] [--reason <text>] [--adapter <file>] -- <wrapped-cli> ...',
    'shapes --grant <jwt> [--adapter <file>] -- <wrapped-cli> ...',
  ].join('\n')
}

async function explain(args: string[]) {
  const { options, command } = parseInvocation(args)
  if (command.length === 0)
    throw new Error('Missing wrapped command')

  const loaded = loadAdapter(command[0]!, options.adapter)
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
}

async function request(args: string[]) {
  const { options, command } = parseInvocation(args)
  if (command.length === 0)
    throw new Error('Missing wrapped command')

  const idp = getIdpUrl(options.idp)
  if (!idp)
    throw new Error('No IdP URL configured. Use --idp or log in with grapes.')

  const loaded = loadAdapter(command[0]!, options.adapter)
  const resolved = await resolveCommand(loaded, command)
  const approval = (options.approval ?? 'once') as 'once' | 'timed' | 'always'
  const grant = await createShapesGrant(resolved, {
    idp,
    approval,
    ...(options.reason ? { reason: options.reason } : {}),
  })

  consola.info(`Grant requested: ${grant.id}`)
  consola.info(`Approve at: ${idp}/grant-approval?grant_id=${grant.id}`)

  const status = await waitForGrantStatus(idp, grant.id)
  if (status !== 'approved') {
    throw new Error(`Grant ${status}`)
  }

  const token = await fetchGrantToken(idp, grant.id)
  await verifyAndExecute(token, resolved)
}

async function execute(args: string[]) {
  const { options, command } = parseInvocation(args)
  if (!options.grant)
    throw new Error('Missing --grant <jwt>')
  if (command.length === 0)
    throw new Error('Missing wrapped command')

  const loaded = loadAdapter(command[0]!, options.adapter)
  const resolved = await resolveCommand(loaded, command)
  await verifyAndExecute(options.grant, resolved)
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(`${usage()}\n`)
    return
  }

  if (args[0] === 'explain') {
    await explain(args.slice(1))
    return
  }

  if (args[0] === 'request') {
    await request(args.slice(1))
    return
  }

  await execute(args)
}

main().catch((error) => {
  consola.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
