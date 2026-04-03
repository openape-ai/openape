import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl, loadAuth } from '../../config'
import { apiFetch, getDelegationsEndpoint } from '../../http'
import { CliError } from '../../errors'

export const delegateCommand = defineCommand({
  meta: {
    name: 'delegate',
    description: 'Create a delegation',
  },
  args: {
    to: {
      type: 'string',
      description: 'Delegate email (who can act on your behalf)',
      required: true,
    },
    at: {
      type: 'string',
      description: 'Service/audience where delegation applies',
      required: true,
    },
    scopes: {
      type: 'string',
      description: 'Comma-separated scopes',
    },
    approval: {
      type: 'string',
      description: 'Approval type: once, timed, always',
      default: 'once',
    },
    expires: {
      type: 'string',
      description: 'Expiration date (ISO 8601)',
    },
  },
  async run({ args }) {
    const auth = loadAuth()
    if (!auth) {
      throw new CliError('Not logged in. Run `apes login` first.')
    }

    const idp = getIdpUrl()!
    const delegationsUrl = await getDelegationsEndpoint(idp)

    const body: Record<string, unknown> = {
      delegate: args.to,
      audience: args.at,
      approval: args.approval,
    }

    if (args.scopes) {
      body.scopes = args.scopes.split(',').map(s => s.trim())
    }

    if (args.expires) {
      body.expires_at = args.expires
    }

    const result = await apiFetch<{ id: string }>(delegationsUrl, {
      method: 'POST',
      body,
    })

    consola.success(`Delegation created: ${result.id}`)
    console.log(`  Delegate: ${args.to}`)
    console.log(`  Audience: ${args.at}`)
    if (args.scopes)
      console.log(`  Scopes:   ${args.scopes}`)
    console.log(`  Approval: ${args.approval}`)
    if (args.expires)
      console.log(`  Expires:  ${args.expires}`)
  },
})
