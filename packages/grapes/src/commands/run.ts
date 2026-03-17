import { execFileSync } from 'node:child_process'
import { hostname } from 'node:os'
import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl, loadAuth } from '../config'
import { apiFetch, getGrantsEndpoint } from '../http'

export const runCommand = defineCommand({
  meta: {
    name: 'run',
    description: 'Request grant for audience, wait for approval, execute',
  },
  args: {
    'audience': {
      type: 'positional',
      description: 'Service identifier (e.g. "apes", "proxy")',
      required: true,
    },
    'action': {
      type: 'positional',
      description: 'Action or command to execute',
      required: true,
    },
    'approval': {
      type: 'string',
      description: 'Approval type: once, timed, always',
      default: 'once',
    },
    'reason': {
      type: 'string',
      description: 'Reason for the request',
    },
    'run-as': {
      type: 'string',
      description: 'Execute as this user identity',
    },
    'host': {
      type: 'string',
      description: 'Target host (default: system hostname)',
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

    const idp = getIdpUrl()!
    const grantsUrl = await getGrantsEndpoint(idp)
    const command = args.action.split(' ')
    const targetHost = args.host || hostname()

    // Step 1: Request grant
    consola.info(`Requesting ${args.audience} grant on ${targetHost}: ${command.join(' ')}`)
    const grant = await apiFetch<{ id: string, status: string }>(grantsUrl, {
      method: 'POST',
      body: {
        requester: auth.email,
        target_host: targetHost,
        audience: args.audience,
        grant_type: args.approval,
        command,
        reason: args.reason || command.join(' '),
        ...(args['run-as'] ? { run_as: args['run-as'] } : {}),
      },
    })
    consola.success(`Grant requested: ${grant.id}`)

    // Step 2: Wait for approval
    consola.info('Waiting for approval...')
    await waitForApproval(grantsUrl, grant.id)

    // Step 3: Get grant token
    consola.info('Fetching grant token...')
    const { authz_jwt } = await apiFetch<{ authz_jwt: string }>(`${grantsUrl}/${grant.id}/token`, {
      method: 'POST',
    })

    // Step 4: Execute or output token
    if (args.audience === 'apes') {
      consola.info(`Executing: ${command.join(' ')}`)
      try {
        execFileSync(args['apes-path'], ['--grant', authz_jwt, '--', ...command], {
          stdio: 'inherit',
        })
      }
      catch (err: unknown) {
        const exitCode = (err as { status?: number }).status || 1
        process.exit(exitCode)
      }
    }
    else {
      // For non-apes audiences, output the token
      process.stdout.write(authz_jwt)
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
