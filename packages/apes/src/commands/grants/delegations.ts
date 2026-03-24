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
    const delegations = await apiFetch<Delegation[]>(delegationsUrl)

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
