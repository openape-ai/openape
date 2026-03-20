import { hostname } from 'node:os'
import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl, loadAuth } from '../config'
import { parseDuration } from '../duration'
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
    audience: {
      type: 'string',
      description: 'Service identifier (e.g. "apes", "proxy")',
      required: true,
    },
    host: {
      type: 'string',
      description: 'Target host (default: system hostname)',
    },
    reason: {
      type: 'string',
      description: 'Reason for the request',
    },
    approval: {
      type: 'string',
      description: 'Approval type: once, timed, always',
      default: 'once',
    },
    duration: {
      type: 'string',
      description: 'Duration for timed grants (e.g. 30m, 1h, 7d)',
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

    const idp = getIdpUrl()!
    const grantsUrl = await getGrantsEndpoint(idp)
    const command = args.command.split(' ')
    const targetHost = args.host || hostname()

    const duration = args.duration ? parseDuration(args.duration) : undefined

    const grant = await apiFetch<{ id: string, status: string }>(grantsUrl, {
      method: 'POST',
      body: {
        requester: auth.email,
        target_host: targetHost,
        audience: args.audience,
        grant_type: args.approval,
        command,
        reason: args.reason || command.join(' '),
        ...(duration != null ? { duration } : {}),
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
