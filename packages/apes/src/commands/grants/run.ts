import { execFileSync } from 'node:child_process'
import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl } from '../../config'
import { CliError, CliExit } from '../../errors'
import { getPollMaxMinutes, pollGrantUntilResolved } from '../../grant-poll'
import { apiFetch, getGrantsEndpoint } from '../../http'
import { fetchGrantToken, resolveFromGrant, verifyAndExecute } from '../../shapes/index.js'

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
    execution_context?: { adapter_digest?: string, argv_hash?: string }
    authorization_details?: Array<{ type?: string, permission?: string }>
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
      // Re-resolve locally from the recorded command + adapter digest.
      let resolved
      try {
        resolved = await resolveFromGrant(grant)
      }
      catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new CliError(`Cannot re-resolve grant: ${msg}`)
      }
      const token = await fetchGrantToken(idp, grant.id)
      await verifyAndExecute(token, resolved)
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
