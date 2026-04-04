import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl } from '../../config'
import { apiFetch, getDelegationsEndpoint } from '../../http'
import { CliError } from '../../errors'

export const delegationRevokeCommand = defineCommand({
  meta: {
    name: 'delegation-revoke',
    description: 'Revoke a delegation',
  },
  args: {
    id: {
      type: 'positional',
      description: 'Delegation ID to revoke',
      required: true,
    },
  },
  async run({ args }) {
    const idp = getIdpUrl()
    if (!idp) {
      throw new CliError('No IdP URL configured. Run `apes login` first or pass --idp.')
    }

    const delegationsUrl = await getDelegationsEndpoint(idp)
    const id = String(args.id)

    const result = await apiFetch<{ id: string, status: string }>(
      `${delegationsUrl}/${id}`,
      { method: 'DELETE' },
    )

    consola.success(`Delegation ${result.id} revoked.`)
  },
})
