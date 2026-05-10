// `apes nest destroy <name>` — Phase D: file-based intent.

import { defineCommand } from 'citty'
import consola from 'consola'
import { dispatchIntent } from '../../lib/nest-intent'

export const destroyNestCommand = defineCommand({
  meta: {
    name: 'destroy',
    description: 'Tear down an agent on the local nest. Drops an intent file the nest daemon picks up.',
  },
  args: {
    name: { type: 'positional', required: true, description: 'Agent name to destroy' },
  },
  async run({ args }) {
    const name = String(args.name)
    await dispatchIntent({ action: 'destroy', name })
    consola.success(`Destroyed ${name}`)
  },
})
