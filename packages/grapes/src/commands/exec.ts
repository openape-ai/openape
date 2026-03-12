import { execFileSync } from 'node:child_process'
import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl, loadAuth, loadConfig } from '../config'
import { apiFetch, getGrantsEndpoint } from '../http'

export const execCommand = defineCommand({
  meta: {
    name: 'exec',
    description: 'Request grant, wait for approval, execute via apes',
  },
  args: {
    'command': {
      type: 'positional',
      description: 'Command to execute (after --)',
      required: true,
    },
    'reason': {
      type: 'string',
      description: 'Reason for the request',
    },
    'for': {
      type: 'string',
      description: 'Target user email (owner/approver)',
    },
    'approval': {
      type: 'string',
      description: 'Approval type: once, timed, always',
    },
    'apes-path': {
      type: 'string',
      description: 'Path to apes binary',
      default: 'apes',
    },
  },
  async run({ args }) {
    const auth = loadAuth()
    if (!auth) {
      consola.error('Not logged in. Run `grapes login` first.')
      return process.exit(1)
    }

    const config = loadConfig()
    const forUser = args.for || config.defaults?.for
    const approval = args.approval || config.defaults?.approval || 'once'

    if (!forUser) {
      consola.error('Target user required. Use --for <email> or set defaults.for in config.')
      return process.exit(1)
    }

    const idp = getIdpUrl()!
    const grantsUrl = await getGrantsEndpoint(idp)
    const command = args.command.split(' ')

    // Step 1: Request grant
    consola.info(`Requesting grant for: ${command.join(' ')}`)
    const grant = await apiFetch<{ id: string, status: string }>(grantsUrl, {
      method: 'POST',
      body: {
        type: 'command',
        requester: auth.email,
        owner: forUser,
        request: {
          command,
          grant_type: approval,
          reason: args.reason || command.join(' '),
        },
      },
    })
    consola.success(`Grant requested: ${grant.id}`)

    // Step 2: Wait for approval
    consola.info('Waiting for approval...')
    await waitForApproval(grantsUrl, grant.id)

    // Step 3: Get grant token
    consola.info('Fetching grant token...')
    const { token } = await apiFetch<{ token: string }>(`${grantsUrl}/${grant.id}/token`, {
      method: 'POST',
    })

    // Step 4: Execute via apes
    consola.info(`Executing: ${command.join(' ')}`)
    try {
      execFileSync(args['apes-path'], ['--grant', token, '--', ...command], {
        stdio: 'inherit',
      })
    } catch (err: unknown) {
      const exitCode = (err as { status?: number }).status || 1
      process.exit(exitCode)
    }
  },
})

async function waitForApproval(grantsUrl: string, grantId: string): Promise<void> {
  const maxWait = 300_000 // 5 minutes
  const interval = 3_000
  const start = Date.now()

  while (Date.now() - start < maxWait) {
    const grant = await apiFetch<{ status: string }>(`${grantsUrl}/${grantId}`)

    if (grant.status === 'approved') {
      consola.success('Grant approved!')
      return
    }
    if (grant.status === 'denied') {
      consola.error('Grant denied.')
      process.exit(1)
    }
    if (grant.status === 'revoked') {
      consola.error('Grant revoked.')
      process.exit(1)
    }

    await new Promise(r => setTimeout(r, interval))
  }

  consola.error('Timed out waiting for approval.')
  process.exit(1)
}
