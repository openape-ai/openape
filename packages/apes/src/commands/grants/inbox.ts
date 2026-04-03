import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl, loadAuth } from '../../config'
import { apiFetch, getGrantsEndpoint } from '../../http'
import { CliError } from '../../errors'

interface Grant {
  id: string
  type: string
  status: string
  requester: string
  owner: string
  request: {
    command?: string[]
    grant_type?: string
    reason?: string
  }
  created_at?: string
}

interface PaginatedGrants {
  data: Grant[]
  pagination: {
    cursor: string | null
    has_more: boolean
  }
}

export const inboxCommand = defineCommand({
  meta: {
    name: 'inbox',
    description: 'Show grants awaiting your approval',
  },
  args: {
    json: {
      type: 'boolean',
      description: 'Output as JSON',
      default: false,
    },
    limit: {
      type: 'string',
      description: 'Max results (default 20, max 100)',
    },
  },
  async run({ args }) {
    const idp = getIdpUrl()
    if (!idp) {
      throw new CliError('No IdP URL configured. Run `apes login` first.')
    }

    const auth = loadAuth()
    if (!auth) {
      throw new CliError('Not logged in. Run `apes login` first.')
    }

    const grantsUrl = await getGrantsEndpoint(idp)
    const params = new URLSearchParams()
    params.set('status', 'pending')
    if (args.limit)
      params.set('limit', args.limit)
    const query = `?${params.toString()}`

    const response = await apiFetch<PaginatedGrants>(`${grantsUrl}${query}`)

    // Filter out own requests — inbox shows only grants from others
    const grants = response.data.filter(g => g.requester !== auth.email)

    if (args.json) {
      console.log(JSON.stringify({ ...response, data: grants }, null, 2))
      return
    }

    if (grants.length === 0) {
      consola.info('No pending grants to approve.')
      return
    }

    consola.info(`${grants.length} grant(s) awaiting approval:\n`)

    for (const grant of grants) {
      const cmd = grant.request?.command?.join(' ') || '(no command)'
      const type = grant.request?.grant_type || grant.type
      console.log(`${grant.id}  ${type.padEnd(6)}  from ${grant.requester}`)
      console.log(`  Command: ${cmd}`)
      if (grant.request?.reason) {
        console.log(`  Reason:  ${grant.request.reason}`)
      }
      if (grant.created_at) {
        console.log(`  Created: ${grant.created_at}`)
      }
      console.log()
    }

    consola.info('Use `apes grants approve <id>` or `apes grants deny <id>` to respond.')
  },
})
