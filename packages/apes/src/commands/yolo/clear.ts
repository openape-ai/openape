// `apes yolo clear <agent-email>` — remove the YOLO-policy from a
// DDISA agent. After clear, every grant request goes through normal
// human approval. Useful for revocation: drop the policy and the agent
// can no longer auto-approve anything until you set a new one.

import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl, loadAuth } from '../../config'
import { CliError } from '../../errors'

export const yoloClearCommand = defineCommand({
  meta: {
    name: 'clear',
    description: 'Remove the YOLO-policy from a DDISA agent (subsequent grants need human approval)',
  },
  args: {
    email: {
      type: 'positional',
      description: 'Target agent email',
      required: true,
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
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerAuth.access_token}` },
    })
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '')
      throw new CliError(`DELETE /yolo-policy failed (${res.status}): ${text}`)
    }
    consola.success(`YOLO-policy cleared on ${email}`)
  },
})
