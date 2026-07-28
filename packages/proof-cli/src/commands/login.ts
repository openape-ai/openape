import { defineCommand } from 'citty'
import type { ProofCliDescriptor } from '../descriptor'
import { error, info } from '../output'

/**
 * Stub login command. Proof-link CLIs no longer manage their own login flow —
 * auth is shared across all OpenApe CLIs via `@openape/cli-auth`, which reads
 * the IdP token written by `apes login` (`~/.config/apes/auth.json`). The
 * message stays app-agnostic so no per-app CLI name can drift out of sync.
 */
export function makeLoginCommand(_d?: Pick<ProofCliDescriptor, 'name'>) {
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
      info('Login is handled by the unified `apes` session, not this CLI.')
      info('')
      info('Run `apes login <email>` once on this device — the same session covers')
      info('ape-tasks, ape-plans, and every other OpenApe SP CLI.')
      info('')
      error('No-op: this command is a stub. Use `apes login`.')
      process.exit(1)
    },
  })
}
