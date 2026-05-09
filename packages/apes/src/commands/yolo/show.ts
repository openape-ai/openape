// `apes yolo show <agent-email>` — print the YOLO-policy currently set
// on an agent. Returns the empty default (`mode: deny-list`, no patterns)
// when no policy has been written. JSON output via --json.

import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl, loadAuth } from '../../config'
import { CliError } from '../../errors'

interface YoloPolicy {
  mode: string
  allowPatterns: string[]
  denyPatterns: string[]
  denyRiskThreshold: string | null
  expiresAt: number | null
}

export const yoloShowCommand = defineCommand({
  meta: {
    name: 'show',
    description: 'Print the YOLO-policy currently set on a DDISA agent',
  },
  args: {
    email: {
      type: 'positional',
      description: 'Target agent email',
      required: true,
    },
    json: {
      type: 'boolean',
      description: 'JSON output for scripts',
    },
  },
  async run({ args }) {
    const ownerAuth = loadAuth()
    if (!ownerAuth?.access_token) {
      throw new CliError('Run `apes login <email>` first.')
    }
    const idp = getIdpUrl()
    if (!idp) throw new CliError('No IdP configured.')

    const email = args.email as string
    const url = `${idp}/api/users/${encodeURIComponent(email)}/yolo-policy`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${ownerAuth.access_token}` },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new CliError(`GET /yolo-policy failed (${res.status}): ${text}`)
    }
    const policy = (await res.json()) as YoloPolicy

    if (args.json) {
      console.log(JSON.stringify(policy, null, 2))
      return
    }
    consola.info(`YOLO-policy for ${email}`)
    consola.info(`  mode:           ${policy.mode}`)
    consola.info(`  allow_patterns: ${policy.allowPatterns.length ? policy.allowPatterns.join(', ') : '(none)'}`)
    consola.info(`  deny_patterns:  ${policy.denyPatterns.length ? policy.denyPatterns.join(', ') : '(none)'}`)
    consola.info(`  deny_risk:      ${policy.denyRiskThreshold ?? '(none)'}`)
    consola.info(`  expires_at:     ${policy.expiresAt ? new Date(policy.expiresAt * 1000).toISOString() : '(never)'}`)
  },
})
