import { defineCommand } from 'citty'
import consola from 'consola'
import { apiFetch } from '../../http'
import { CliError } from '../../errors'

export const sessionsRemoveCommand = defineCommand({
  meta: {
    name: 'remove',
    description: 'Revoke one of your active refresh-token families by id.',
  },
  args: {
    familyId: {
      type: 'positional',
      required: true,
      description: 'Family id (from `apes sessions list`).',
    },
  },
  async run({ args }) {
    const id = String(args.familyId).trim()
    if (!id) throw new CliError('familyId required')
    await apiFetch(`/api/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
    consola.success(`Session ${id} revoked. The device using it will need to \`apes login\` again on its next refresh.`)
  },
})
