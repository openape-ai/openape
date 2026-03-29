import { defineCommand } from 'citty'
import consola from 'consola'
import { getAuthToken, getIdpUrl, loadAuth } from '../../config'
import { apiFetch, getGrantsEndpoint } from '../../http'

interface Grant {
  id: string
  status: string
  requester: string
  request: { command?: string[] }
}

interface PaginatedGrants {
  data: Grant[]
  pagination: { cursor: string | null, has_more: boolean }
}

interface BatchResult {
  id: string
  status: string
  success: boolean
  error?: { title: string }
}

export const revokeCommand = defineCommand({
  meta: {
    name: 'revoke',
    description: 'Revoke one or more grants',
  },
  args: {
    id: {
      type: 'positional',
      description: 'Grant ID(s) to revoke',
      required: false,
    },
    allPending: {
      type: 'boolean',
      description: 'Revoke all own pending grants',
      default: false,
    },
    debug: {
      type: 'boolean',
      description: 'Print debug information (does not include full tokens)',
      default: false,
    },
  },
  async run({ args }) {
    const auth = loadAuth()
    const token = getAuthToken()
    const idp = getIdpUrl()!
    const grantsUrl = await getGrantsEndpoint(idp)

    if (args.debug) {
      consola.debug(`idp: ${idp}`)
      consola.debug(`grantsUrl: ${grantsUrl}`)
      consola.debug(`auth.email: ${auth?.email}`)
      consola.debug(`auth.expires_at: ${auth?.expires_at} (now: ${Math.floor(Date.now() / 1000)})`)
      consola.debug(`getAuthToken(): ${token ? `${token.substring(0, 20)}...` : 'NULL'}`)
    }

    if (!auth || !token) {
      consola.error('Authentication required')
      consola.info('Run `apes login` and try again.')
      return process.exit(1)
    }

    const explicitIds = args.id
      ? [String(args.id), ...args._].filter(Boolean)
      : []

    if (args.allPending && explicitIds.length > 0) {
      consola.error('Use either --all-pending or grant IDs, not both.')
      return process.exit(1)
    }

    let ids: string[]

    if (args.allPending) {
      const auth = loadAuth()
      const response = await apiFetch<PaginatedGrants>(
        `${grantsUrl}?status=pending&limit=100`,
        { token },
      )
      const ownPending = auth?.email
        ? response.data.filter(g => g.requester === auth.email)
        : response.data
      if (ownPending.length === 0) {
        consola.info('No pending grants to revoke.')
        return
      }
      ids = ownPending.map(g => g.id)
      consola.info(`Found ${ids.length} pending grant(s) to revoke.`)
    }
    else if (explicitIds.length > 0) {
      ids = explicitIds
    }
    else {
      consola.error('Provide grant ID(s) or use --all-pending.')
      return process.exit(1)
    }

    // Single grant: use direct endpoint
    if (ids.length === 1) {
      await apiFetch(`${grantsUrl}/${ids[0]}/revoke`, { method: 'POST', token: token || undefined })
      consola.success(`Grant ${ids[0]} revoked.`)
      return
    }

    // Multiple grants: use batch endpoint
    const operations = ids.map(id => ({ id, action: 'revoke' as const }))
    const { results } = await apiFetch<{ results: BatchResult[] }>(
      `${grantsUrl}/batch`,
      { method: 'POST', body: { operations }, token: token || undefined },
    )

    let succeeded = 0
    for (const r of results) {
      if (r.success) {
        consola.success(`Grant ${r.id} revoked.`)
        succeeded++
      }
      else {
        consola.error(`Grant ${r.id}: ${r.error?.title || 'Failed'}`)
      }
    }

    if (succeeded < results.length) {
      consola.info(`Revoked ${succeeded} of ${results.length} grants.`)
      process.exit(1)
    }
    else {
      consola.success(`All ${succeeded} grants revoked.`)
    }
  },
})
