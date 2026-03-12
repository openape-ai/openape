import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl } from '../config'
import { apiFetch, getGrantsEndpoint } from '../http'

export const approveCommand = defineCommand({
  meta: {
    name: 'approve',
    description: 'Approve a grant request',
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
    await apiFetch(`${grantsUrl}/${args.id}/approve`, {
      method: 'POST',
    })
    consola.success(`Grant ${args.id} approved.`)
  },
})
