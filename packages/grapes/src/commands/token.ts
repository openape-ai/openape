import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl } from '../config'
import { apiFetch, getGrantsEndpoint } from '../http'

export const tokenCommand = defineCommand({
  meta: {
    name: 'token',
    description: 'Get grant token JWT',
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
    const result = await apiFetch<{ authz_jwt: string }>(`${grantsUrl}/${args.id}/token`, {
      method: 'POST',
    })

    if (!result.authz_jwt) {
      consola.error('No token received. Grant may not be approved.')
      return process.exit(1)
    }

    // Output raw token to stdout (pipeable)
    process.stdout.write(result.authz_jwt)
  },
})
