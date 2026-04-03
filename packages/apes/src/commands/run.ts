import { execFileSync } from 'node:child_process'
import { hostname } from 'node:os'
import { defineCommand } from 'citty'
import {
  createShapesGrant,
  extractOption,
  extractWrappedCommand,
  fetchGrantToken,
  findExistingGrant,
  loadAdapter,
  resolveCommand,
  verifyAndExecute,
  waitForGrantStatus,
} from '@openape/shapes'
import consola from 'consola'
import { getIdpUrl, loadAuth } from '../config'
import { apiFetch, getGrantsEndpoint } from '../http'
import { CliError, CliExit } from '../errors'

export const runCommand = defineCommand({
  meta: {
    name: 'run',
    description: 'Execute a grant-secured command',
  },
  args: {
    'approval': {
      type: 'string',
      description: 'Approval type: once, timed, always',
      default: 'once',
    },
    'reason': {
      type: 'string',
      description: 'Reason for the grant request',
    },
    'adapter': {
      type: 'string',
      description: 'Explicit path to adapter TOML file',
    },
    'as': {
      type: 'string',
      description: 'Execute as this user (delegates to escapes)',
    },
    'host': {
      type: 'string',
      description: 'Target host (default: system hostname)',
    },
    'escapes-path': {
      type: 'string',
      description: 'Path to escapes binary',
      default: 'escapes',
    },
    'idp': {
      type: 'string',
      description: 'IdP URL',
    },
    '_': {
      type: 'positional',
      description: 'Command to execute (after --)',
      required: false,
    },
  },
  async run({ rawArgs, args }) {
    const wrappedCommand = extractWrappedCommand(rawArgs ?? [])

    if (wrappedCommand.length > 0) {
      // Adapter mode: apes run [options] -- <cli> <args...>
      await runAdapterMode(wrappedCommand, rawArgs ?? [], args)
    }
    else {
      // Audience mode: apes run <audience> <action>
      // Extract audience and action from rawArgs (before --)
      const positionals = extractPositionals(rawArgs ?? [])
      if (positionals.length < 2)
        throw new Error('Usage: apes run -- <cli> <args...>  OR  apes run <audience> <action>')
      await runAudienceMode(positionals[0]!, positionals[1]!, args)
    }
  },
})

function extractPositionals(rawArgs: string[]): string[] {
  const positionals: string[] = []
  const delimiter = rawArgs.indexOf('--')
  const args = delimiter >= 0 ? rawArgs.slice(0, delimiter) : rawArgs

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === 'run')
      continue
    if (arg.startsWith('--')) {
      i++ // skip flag value
      continue
    }
    positionals.push(arg)
  }
  return positionals
}

async function runAdapterMode(
  command: string[],
  rawArgs: string[],
  args: Record<string, unknown>,
) {
  const idp = getIdpUrl(args.idp as string | undefined)
  if (!idp)
    throw new Error('No IdP URL configured. Run `apes login` first or pass --idp.')

  // If caller wants to run as another user (e.g. root), auto-switch to the escapes audience flow.
  // Adapter mode (Shapes) is user-level and cannot elevate privileges.
  if (args.as) {
    await runAudienceMode('escapes', command.join(' '), args)
    return
  }

  const adapterOpt = extractOption(rawArgs, 'adapter')
  const loaded = loadAdapter(command[0]!, adapterOpt)
  const resolved = await resolveCommand(loaded, command)
  const approval = (args.approval ?? 'once') as 'once' | 'timed' | 'always'

  // Try reusing an existing timed/always grant (findExistingGrant skips once grants)
  try {
    const existingGrantId = await findExistingGrant(resolved, idp)
    if (existingGrantId) {
      consola.info(`Reusing existing grant: ${existingGrantId}`)
      const token = await fetchGrantToken(idp, existingGrantId)
      await verifyAndExecute(token, resolved)
      return
    }
  }
  catch {
    // Fall through to creating a new grant
  }

  const grant = await createShapesGrant(resolved, {
    idp,
    approval,
    ...(args.reason ? { reason: args.reason as string } : {}),
  })

  consola.info(`Grant requested: ${grant.id}`)
  consola.info(`Approve at: ${idp}/grant-approval?grant_id=${grant.id}`)

  if (grant.similar_grants?.similar_grants?.length) {
    const n = grant.similar_grants.similar_grants.length
    consola.info('')
    consola.info(`  Similar grant(s) found (${n}). Your approver can extend an existing grant to cover this request.`)
    if (grant.similar_grants.widened_details?.length) {
      const wider = grant.similar_grants.widened_details.map(d => d.permission).join(', ')
      consola.info(`  Broader scope: ${wider}`)
    }
    consola.info('')
  }

  const status = await waitForGrantStatus(idp, grant.id)
  if (status !== 'approved')
    throw new Error(`Grant ${status}`)

  const token = await fetchGrantToken(idp, grant.id)
  await verifyAndExecute(token, resolved)
}

async function runAudienceMode(
  audience: string,
  action: string,
  args: Record<string, unknown>,
) {
  const auth = loadAuth()
  if (!auth) {
    throw new CliError('Not logged in. Run `apes login` first.')
  }

  const idp = getIdpUrl(args.idp as string | undefined)!
  const grantsUrl = await getGrantsEndpoint(idp)
  const command = action.split(' ')
  const targetHost = (args.host as string) || hostname()

  // Step 1: Request grant
  consola.info(`Requesting ${audience} grant on ${targetHost}: ${command.join(' ')}`)
  const grant = await apiFetch<{ id: string, status: string }>(grantsUrl, {
    method: 'POST',
    body: {
      requester: auth.email,
      target_host: targetHost,
      audience,
      grant_type: args.approval,
      command,
      reason: (args.reason as string) || command.join(' '),
      ...(args.as ? { run_as: args.as } : {}),
    },
  })
  consola.success(`Grant requested: ${grant.id}`)

  // Step 2: Wait for approval
  consola.info('Waiting for approval...')
  const maxWait = 300_000
  const interval = 3_000
  const start = Date.now()

  while (Date.now() - start < maxWait) {
    const status = await apiFetch<{ status: string }>(`${grantsUrl}/${grant.id}`)
    if (status.status === 'approved') {
      consola.success('Grant approved!')
      break
    }
    if (status.status === 'denied' || status.status === 'revoked') {
      throw new CliError(`Grant ${status.status}.`)
    }
    await new Promise(r => setTimeout(r, interval))
  }

  // Step 3: Get grant token
  consola.info('Fetching grant token...')
  const { authz_jwt } = await apiFetch<{ authz_jwt: string }>(`${grantsUrl}/${grant.id}/token`, {
    method: 'POST',
  })

  // Step 4: Execute or output token
  if (audience === 'escapes') {
    consola.info(`Executing: ${command.join(' ')}`)
    try {
      execFileSync((args['escapes-path'] as string) || 'escapes', ['--grant', authz_jwt, '--', ...command], {
        stdio: 'inherit',
      })
    }
    catch (err: unknown) {
      const exitCode = (err as { status?: number }).status || 1
      throw new CliExit(exitCode)
    }
  }
  else {
    process.stdout.write(authz_jwt)
  }
}
