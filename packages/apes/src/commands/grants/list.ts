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

export const listCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'List your grants (as requester)',
  },
  args: {
    status: {
      type: 'string',
      description: 'Filter by status (pending, approved, denied, revoked, used)',
    },
    all: {
      type: 'boolean',
      description: 'Show all visible grants (not just your own)',
      default: false,
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
      throw new CliError('No IdP URL configured. Run `apes login` first or pass --idp.')
    }

    const auth = loadAuth()

    const grantsUrl = await getGrantsEndpoint(idp)
    const params = new URLSearchParams()
    if (args.status)
      params.set('status', args.status)
    if (args.limit)
      params.set('limit', args.limit)
    const query = params.toString() ? `?${params.toString()}` : ''

    const response = await apiFetch<PaginatedGrants>(`${grantsUrl}${query}`)

    let grants = response.data

    // Filter to own grants unless --all
    if (!args.all && auth?.email) {
      grants = grants.filter(g => g.requester === auth.email)
    }

    if (args.json) {
      console.log(JSON.stringify(args.all ? response : { ...response, data: grants }, null, 2))
      return
    }

    if (grants.length === 0) {
      consola.info(args.all ? 'No grants found.' : 'No grants found. Use --all to see all visible grants.')
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
      consola.info('More results available. Use --limit or pagination cursor.')
    }
  },
})
