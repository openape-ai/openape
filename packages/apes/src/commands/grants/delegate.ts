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

    // Server expects `grant_type`, not `approval`. The CLI flag stays
    // named `--approval` for UX continuity (matches the term humans
    // see in the IdP grant-approval UI), but the request body must
    // carry the wire name. Without this rename the server always
    // defaults to grant_type='once' regardless of the flag value.
    const body: Record<string, unknown> = {
      delegate: args.to,
      audience: args.at,
      grant_type: args.approval,
    }

    if (args.scopes) {
      body.scopes = args.scopes.split(',').map(s => s.trim())
    }

    if (args.expires) {
      // The IdP's /api/delegations endpoint validates timed grants with a
      // `duration` field (seconds), not an ISO `expires_at`. Convert here
      // so users can keep using a human-friendly --expires timestamp.
      if (args.approval === 'timed') {
        const expiresMs = Date.parse(args.expires)
        if (Number.isNaN(expiresMs)) {
          throw new CliError(`Invalid --expires value: "${args.expires}" is not an ISO 8601 timestamp.`)
        }
        const durationSec = Math.floor((expiresMs - Date.now()) / 1000)
        if (durationSec <= 0) {
          throw new CliError(`Invalid --expires value: "${args.expires}" is in the past.`)
        }
        body.duration = durationSec
      }
      else {
        body.expires_at = args.expires
      }
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
