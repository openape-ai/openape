import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl } from '../../config'
import { apiFetch, getDelegationsEndpoint } from '../../http'

interface Delegation {
  id: string
  delegator: string
  delegate: string
  audience: string
  scopes?: string[]
  approval: string
  created_at?: string
  expires_at?: string
}

interface PaginatedDelegations {
  data: Delegation[]
  pagination: { cursor: string | null, has_more: boolean }
}

export const delegationsCommand = defineCommand({
  meta: {
    name: 'delegations',
    description: 'List delegations',
  },
  args: {
    json: {
      type: 'boolean',
      description: 'Output as JSON',
      default: false,
    },
  },
  async run({ args }) {
    const idp = getIdpUrl()!
    const delegationsUrl = await getDelegationsEndpoint(idp)
    const response = await apiFetch<PaginatedDelegations>(delegationsUrl)

    // Support both paginated and legacy plain-array responses
    const delegations = Array.isArray(response) ? response : response.data

    if (args.json) {
      console.log(JSON.stringify(delegations, null, 2))
      return
    }

    if (delegations.length === 0) {
      consola.info('No delegations found.')
      return
    }

    for (const d of delegations) {
      const scopes = d.scopes?.join(', ') || '(all)'
      const expires = d.expires_at ? ` expires ${d.expires_at}` : ''
      console.log(`${d.id}  ${d.delegator} → ${d.delegate}  at ${d.audience}  [${scopes}]${expires}`)
    }
  },
})
