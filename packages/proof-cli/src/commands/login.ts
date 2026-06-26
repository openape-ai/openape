import { defineCommand } from 'citty'
import type { ProofCliDescriptor } from '../descriptor'
import { error, info } from '../output'

/**
 * Stub login command. Proof-link CLIs no longer manage their own login flow —
 * auth is shared across all OpenApe CLIs via `@openape/cli-auth`, which reads
 * the IdP token written by `apes login` (`~/.config/apes/auth.json`).
 */
export function makeLoginCommand(d: Pick<ProofCliDescriptor, 'name'>) {
  return defineCommand({
    meta: {
      name: 'login',
      description: 'DEPRECATED — use `apes login <email>` instead.',
    },
    args: {
      email: {
        type: 'positional',
        required: false,
        description: 'Ignored.',
      },
    },
    async run() {
      info(`ape-${d.name} 1.0+ uses the unified \`apes\` auth session.`)
      info('')
      info('Run `apes login <email>` once on this device, then the CLI works')
      info('without per-CLI authentication. The same `apes login` covers ape-plans,')
      info('upcoming ape-secrets / ape-seeds, and any future OpenApe SP CLI.')
      info('')
      error(`No-op: ape-${d.name} login is a stub.`)
      process.exit(1)
    },
  })
}
