import { execFileSync } from 'node:child_process'
import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl } from '../../config'
import { CliError, CliExit } from '../../errors'
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
  },
  async run({ args }) {
    const idp = getIdpUrl()
    if (!idp)
      throw new CliError('No IdP URL configured. Run `apes login` first or pass --idp.')

    const grantsUrl = await getGrantsEndpoint(idp)
    const grant = await apiFetch<GrantDetail>(`${grantsUrl}/${args.id}`)

    // --- status gate ---
    if (grant.status === 'pending')
      throw new CliError(`Grant ${grant.id} is still pending. Approve at: ${idp}/grant-approval?grant_id=${grant.id}`)
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
