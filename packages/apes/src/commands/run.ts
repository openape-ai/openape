import { execFileSync } from 'node:child_process'
import { hostname } from 'node:os'
import { defineCommand } from 'citty'
import {
  createShapesGrant,
  extractOption,
  extractShellCommandString,
  extractWrappedCommand,
  fetchGrantToken,
  findExistingGrant,
  loadAdapter,
  loadOrInstallAdapter,
  parseShellCommand,
  resolveCommand,
  verifyAndExecute,
  waitForGrantStatus,
} from '../shapes/index.js'
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
    'shell': {
      type: 'boolean',
      description: 'Shell mode: use session grant with audience ape-shell',
      default: false,
    },
    '_': {
      type: 'positional',
      description: 'Command to execute (after --)',
      required: false,
    },
  },
  async run({ rawArgs, args }) {
    const wrappedCommand = extractWrappedCommand(rawArgs ?? [])

    if (args.shell && wrappedCommand.length > 0) {
      // Shell mode: ape-shell -c "command" → apes run --shell -- bash -c "command"
      await runShellMode(wrappedCommand, args)
      return
    }

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

async function runShellMode(
  command: string[],
  args: Record<string, unknown>,
) {
  const auth = loadAuth()
  if (!auth)
    throw new CliError('Not logged in. Run `apes login` first.')

  const idp = getIdpUrl(args.idp as string | undefined)
  if (!idp)
    throw new CliError('No IdP URL configured. Run `apes login` first or pass --idp.')

  // Try to handle this command via the shapes adapter system first.
  // This gives us structured grants with resource chains (e.g. "rm file:/tmp/foo.txt")
  // instead of opaque "bash -c …" grants.
  const adapterHandled = await tryAdapterModeFromShell(command, idp, args)
  if (adapterHandled) return

  const grantsUrl = await getGrantsEndpoint(idp)
  const targetHost = (args.host as string) || hostname()

  // Try to find an existing timed/always session grant for ape-shell
  try {
    const grants = await apiFetch<{ data: Array<{ id: string, status: string, request: { audience: string, target_host: string, grant_type: string } }> }>(
      `${grantsUrl}?requester=${encodeURIComponent(auth.email)}&status=approved&limit=20`,
    )
    const sessionGrant = grants.data.find(g =>
      g.request.audience === 'ape-shell'
      && g.request.target_host === targetHost
      && g.request.grant_type !== 'once',
    )
    if (sessionGrant) {
      execShellCommand(command)
      return
    }
  }
  catch {
    // Fall through to creating a new grant
  }

  // No session grant found — request one. Default: 'once', but the approver
  // can upgrade to 'timed' or 'always' during approval to enable reuse.
  consola.info(`Requesting ape-shell session grant on ${targetHost}`)
  const grant = await apiFetch<{ id: string, status: string }>(grantsUrl, {
    method: 'POST',
    body: {
      requester: auth.email,
      target_host: targetHost,
      audience: 'ape-shell',
      grant_type: 'once',
      command: command.slice(0, 3),
      reason: `Shell session: ${command.join(' ').slice(0, 100)}`,
    },
  })

  consola.info(`Grant requested: ${grant.id}`)
  consola.info('Waiting for approval...')

  const maxWait = 300_000
  const interval = 3_000
  const start = Date.now()

  while (Date.now() - start < maxWait) {
    const status = await apiFetch<{ status: string }>(`${grantsUrl}/${grant.id}`)
    if (status.status === 'approved')
      break
    if (status.status === 'denied' || status.status === 'revoked')
      throw new CliError(`Grant ${status.status}.`)
    await new Promise(r => setTimeout(r, interval))
  }

  execShellCommand(command)
}

/**
 * Try to handle a shell command via the shapes adapter system.
 *
 * Flow:
 * 1. Extract the command string from `bash -c "…"` argv
 * 2. Parse into executable + argv (bail out on compound commands)
 * 3. Load adapter locally, or auto-install from registry
 * 4. Resolve the command against adapter operations → structured CLI grant detail
 * 5. Reuse an existing matching grant, or request a new one and execute
 *
 * Returns true when the command was handled (executed or failed hard).
 * Returns false for any reason — caller should fall back to the generic session grant.
 */
async function tryAdapterModeFromShell(
  command: string[],
  idp: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  const cmdString = extractShellCommandString(command)
  if (!cmdString) return false

  const parsed = parseShellCommand(cmdString)
  if (!parsed) return false
  if (parsed.isCompound) return false

  const loaded = await loadOrInstallAdapter(parsed.executable)
  if (!loaded) return false

  let resolved
  try {
    resolved = await resolveCommand(loaded, [parsed.executable, ...parsed.argv])
  }
  catch (err) {
    consola.debug(`ape-shell: adapter resolve failed for "${parsed.raw}":`, err)
    return false
  }

  // Try to reuse an existing matching grant (with widening support)
  try {
    const existingGrantId = await findExistingGrant(resolved, idp)
    if (existingGrantId) {
      consola.info(`Reusing grant ${existingGrantId} for: ${resolved.detail.display}`)
      const token = await fetchGrantToken(idp, existingGrantId)
      await verifyAndExecute(token, resolved)
      return true
    }
  }
  catch {
    // Fall through to request a new grant
  }

  // Request a new grant for this specific command
  const approval = (args.approval ?? 'once') as 'once' | 'timed' | 'always'
  consola.info(`Requesting grant for: ${resolved.detail.display}`)
  const grant = await createShapesGrant(resolved, {
    idp,
    approval,
    reason: (args.reason as string) || `ape-shell: ${resolved.detail.display}`,
  })

  consola.info(`Grant requested: ${grant.id}`)
  consola.info(`Approve at: ${idp}/grant-approval?grant_id=${grant.id}`)

  if (grant.similar_grants?.similar_grants?.length) {
    const n = grant.similar_grants.similar_grants.length
    consola.info('')
    consola.info(`  Similar grant(s) found (${n}). Your approver can extend an existing grant to cover this request.`)
  }

  const status = await waitForGrantStatus(idp, grant.id)
  if (status !== 'approved')
    throw new CliError(`Grant ${status}`)

  const token = await fetchGrantToken(idp, grant.id)
  await verifyAndExecute(token, resolved)
  return true
}

/** Execute a shell command as [shell, '-c', command_string] via execFileSync */
function execShellCommand(command: string[]): void {
  if (command.length === 0)
    throw new CliError('No command to execute')
  try {
    execFileSync(command[0]!, command.slice(1), { stdio: 'inherit' })
  }
  catch (err: unknown) {
    const exitCode = (err as { status?: number }).status || 1
    throw new CliExit(exitCode)
  }
}

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
