import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl, loadAuth, loadConfig } from '../config'
import { apiFetch, getGrantsEndpoint } from '../http'

export const requestCommand = defineCommand({
  meta: {
    name: 'request',
    description: 'Request a new grant',
  },
  args: {
    command: {
      type: 'positional',
      description: 'Command to request permission for',
      required: true,
    },
    reason: {
      type: 'string',
      description: 'Reason for the request',
    },
    for: {
      type: 'string',
      description: 'Target user email (owner/approver)',
    },
    approval: {
      type: 'string',
      description: 'Approval type: once, timed, always',
    },
    wait: {
      type: 'boolean',
      description: 'Wait for approval',
      default: false,
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

    consola.success(`Grant requested: ${grant.id} (status: ${grant.status})`)

    if (args.wait) {
      consola.info('Waiting for approval...')
      await waitForApproval(grantsUrl, grant.id)
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
      return process.exit(1)
    }
    if (grant.status === 'revoked') {
      consola.error('Grant revoked.')
      return process.exit(1)
    }

    await new Promise(r => setTimeout(r, interval))
  }

  consola.error('Timed out waiting for approval.')
  return process.exit(1)
}
