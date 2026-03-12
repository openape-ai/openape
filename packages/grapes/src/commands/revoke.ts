import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl } from '../config'
import { apiFetch, getGrantsEndpoint } from '../http'

export const revokeCommand = defineCommand({
  meta: {
    name: 'revoke',
    description: 'Revoke a grant',
  },
  args: {
    id: {
      type: 'positional',
      description: 'Grant ID',
      required: true,
    },
  },
  async run({ args }) {
    const idp = getIdpUrl()!
    const grantsUrl = await getGrantsEndpoint(idp)
    await apiFetch(`${grantsUrl}/${args.id}/revoke`, {
      method: 'POST',
    })
    consola.success(`Grant ${args.id} revoked.`)
  },
})
