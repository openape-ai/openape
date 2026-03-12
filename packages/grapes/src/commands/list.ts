import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl } from '../config'
import { apiFetch, getGrantsEndpoint } from '../http'

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

export const listCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'List grants',
  },
  args: {
    status: {
      type: 'string',
      description: 'Filter by status (pending, approved, denied, revoked, used)',
    },
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
      consola.error('No IdP URL configured. Run `grapes login` first or pass --idp.')
      return process.exit(1)
    }

    const grantsUrl = await getGrantsEndpoint(idp)
    const params = new URLSearchParams()
    if (args.status) params.set('status', args.status)
    if (args.limit) params.set('limit', args.limit)
    const query = params.toString() ? `?${params.toString()}` : ''

    const response = await apiFetch<PaginatedGrants>(`${grantsUrl}${query}`)

    if (args.json) {
      console.log(JSON.stringify(response, null, 2))
      return
    }

    const grants = response.data
    if (grants.length === 0) {
      consola.info('No grants found.')
      return
    }

    for (const grant of grants) {
      const cmd = grant.request?.command?.join(' ') || '(no command)'
      const type = grant.request?.grant_type || grant.type
      console.log(`${grant.id}  ${grant.status.padEnd(8)}  ${type.padEnd(6)}  ${cmd}`)
      if (grant.request?.reason) {
        console.log(`  Reason: ${grant.request.reason}`)
      }
    }

    if (response.pagination.has_more) {
      consola.info(`More results available. Use --limit or pagination cursor.`)
    }
  },
})
