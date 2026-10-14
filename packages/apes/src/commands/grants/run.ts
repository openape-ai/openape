import { execFileSync } from 'node:child_process'
import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl, loadAuth } from '../../config'
import { CliError, CliExit } from '../../errors'
import { getPollMaxMinutes, pollGrantUntilResolved } from '../../grant-poll'
import { apiFetch, getGrantsEndpoint } from '../../http'
import { AuthorizationRefusedError, authorizeProgramCall, locateProgram } from '../../authorization/program'
import { executeProgramCall } from '../../authorization/execute'
import { shellTargetHost } from '../../shell/context'

interface GrantDetail {
  id: string
  type: string
  status: string
  requester: string
  owner: string
  request: {
    command?: string[]
    audience?: string
    grant_type?: string
    target_host?: string
    execution_context?: { argv?: string[], program_sha256?: string }
    authorization_details?: Array<{ type?: string, permission?: string, operation_id?: string, cli_id?: string }>
  }
}

export const runGrantCommand = defineCommand({
  meta: {
    name: 'run',
    description: 'Execute a previously-approved grant by ID',
  },
  args: {
    id: {
      type: 'positional',
      description: 'Grant ID',
      required: true,
    },
    'escapes-path': {
      type: 'string',
      description: 'Path to escapes binary (audience=escapes only)',
      default: 'escapes',
    },
    wait: {
      type: 'boolean',
      description: 'If the grant is pending, block and poll until approved (or denied/revoked/used/timeout). Reuses APES_GRANT_POLL_INTERVAL / APES_GRANT_POLL_MAX_MINUTES knobs.',
      default: false,
    },
  },
  async run({ args }) {
    const idp = getIdpUrl()
    if (!idp)
      throw new CliError('No IdP URL configured. Run `apes login` first or pass --idp.')

    const grantsUrl = await getGrantsEndpoint(idp)
    let grant = await apiFetch<GrantDetail>(`${grantsUrl}/${args.id}`)

    // --- status gate ---
    // Pending status has two paths: default error, or --wait poll loop.
    // The CLI-side poll is the "ape-shell -c \"apes grants run <id> --wait\""
    // pattern that agents use: one tool call, the CLI handles the wait,
    // and the agent only sees the final state. See `commands/run.ts`
    // `printPendingGrantInfo` agent-mode text for the usage contract.
    if (grant.status === 'pending') {
      if (!args.wait) {
        throw new CliError(
          `Grant ${grant.id} is still pending. Approve at: ${idp}/grant-approval?grant_id=${grant.id}`,
        )
      }
      const maxMinutes = getPollMaxMinutes()
      consola.info(`Waiting for grant ${grant.id} approval (up to ${maxMinutes} minute${maxMinutes === 1 ? '' : 's'})...`)
      const outcome = await pollGrantUntilResolved(idp, grant.id)
      if (outcome.kind === 'timeout') {
        throw new CliError(
          `Grant ${grant.id} approval timed out after ${maxMinutes} minute${maxMinutes === 1 ? '' : 's'}. `
          + `Re-run after approval, or extend the timeout via APES_GRANT_POLL_MAX_MINUTES.`,
        )
      }
      if (outcome.kind === 'terminal') {
        throw new CliError(
          `Grant ${grant.id} resolved to ${outcome.status}. Request a new one.`,
        )
      }
      // outcome.kind === 'approved' — re-fetch the grant so we have the
      // up-to-date shape (approver, decided_at, etc.) for downstream code.
      grant = await apiFetch<GrantDetail>(`${grantsUrl}/${args.id}`)
      consola.info(`Grant ${grant.id} approved — continuing`)
    }

    if (grant.status === 'denied' || grant.status === 'revoked')
      throw new CliError(`Grant ${grant.id} is ${grant.status}. Request a new one.`)
    if (grant.status === 'used')
      throw new CliError(`Grant ${grant.id} has already been used. Request a new one (single-use grants cannot be re-executed).`)
    if (grant.status !== 'approved')
      throw new CliError(`Grant ${grant.id} has unexpected status: ${grant.status}`)

    // --- dispatch by grant shape ---
    const audience = grant.request?.audience
    const authDetails = grant.request?.authorization_details ?? []
    const hasOpenApeCliDetail = authDetails.some(d => d?.type === 'openape_cli')
    const isShapesGrant = hasOpenApeCliDetail || audience === 'shapes'

    if (isShapesGrant) {
      await runProgramGrant(grant, idp)
      return
    }

    if (audience === 'escapes') {
      const { authz_jwt } = await apiFetch<{ authz_jwt: string }>(`${grantsUrl}/${grant.id}/token`, { method: 'POST' })
      const command = grant.request?.command ?? []
      if (command.length === 0)
        throw new CliError(`Grant ${grant.id} has no command to execute.`)
      consola.info(`Executing via escapes: ${command.join(' ')}`)
      try {
        execFileSync(args['escapes-path'] as string, ['--grant', authz_jwt, '--', ...command], { stdio: 'inherit' })
      }
      catch (err: unknown) {
        const exitCode = (err as { status?: number }).status || 1
        throw new CliExit(exitCode)
      }
      return
    }

    if (audience === 'ape-shell') {
      // Legacy shell-session grants can't be re-executed standalone — they
      // were created for a specific bash -c line that only made sense inside
      // the original apes run --shell invocation.
      throw new CliError(
        `Grant ${grant.id} is an ape-shell session grant and cannot be re-executed via \`apes grants run\`. `
        + `Re-run the original command — if the grant was approved as timed/always, the REPL will reuse it automatically.`,
      )
    }

    throw new CliError(`Grant ${grant.id} has unsupported audience "${audience}" — no execution path available.`)
  },
})

/**
 * Runs the command a program grant was requested for: the program named by its execution argv is located and
 * hashed again, the call is authorized at the IdP (which finds the approved grant) and runs only with a verified
 * command token. A program file that changed since the request is refused.
 */
async function runProgramGrant(grant: GrantDetail, idp: string): Promise<void> {
  const auth = loadAuth()
  if (!auth)
    throw new CliError('Not logged in. Run `apes login` first.')
  const [name, ...argv] = grant.request.execution_context?.argv ?? []
  if (!name)
    throw new CliError(`Grant ${grant.id} carries no command to run`)
  const program = await locateProgram(name)
  if (!program)
    throw new CliError(`${name}: no executable file found`)
  const recorded = grant.request.execution_context?.program_sha256
  if (recorded && recorded !== program.sha256)
    throw new CliError(`${program.path} changed since grant ${grant.id} was requested. Run the command again to request a new grant.`)

  const call = { program, argv }
  const authorization = await authorizeProgramCall(call, { idp, subject: auth.email, targetHost: shellTargetHost(), grantType: 'once', wait: false })
    .catch((error: unknown) => {
      throw error instanceof AuthorizationRefusedError ? new CliError(error.message) : error
    })
  if (authorization.kind === 'pending')
    throw new CliError(`Grant ${grant.id} does not authorize this command here; request ${authorization.grantId} awaits approval at ${authorization.approvalUrl}`)
  executeProgramCall(call)
}
