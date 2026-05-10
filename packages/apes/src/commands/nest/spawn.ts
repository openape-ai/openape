// `apes nest spawn <name>` — Phase F (#sim-arch): direct shell-out to
// `apes run --as root --wait -- apes agents spawn ...`. The spawn
// command itself writes to the Nest's `agents.json` registry; the
// Nest watches the file and starts the bridge via pm2 automatically.
// No intent-channel, no HTTP API — the CLI just does the work.

import { execFileSync } from 'node:child_process'
import { defineCommand } from 'citty'
import consola from 'consola'
import { CliExit } from '../../errors'

export const spawnNestCommand = defineCommand({
  meta: {
    name: 'spawn',
    description: 'Spawn a new agent locally. Wraps `apes run --as root -- apes agents spawn <name>`; the Nest watches its registry and starts the bridge in pm2 automatically.',
  },
  args: {
    name: { type: 'positional', required: true, description: 'Agent name (lowercase, [a-z0-9-], max 24 chars)' },
    'no-bridge': { type: 'boolean', description: 'Skip installing the chat-bridge daemon (default: install it)' },
    'bridge-key': { type: 'string', description: 'Override LITELLM_API_KEY (default: read from ~/litellm/.env)' },
    'bridge-base-url': { type: 'string', description: 'Override LITELLM_BASE_URL' },
    'bridge-model': { type: 'string', description: 'Override APE_CHAT_BRIDGE_MODEL' },
  },
  async run({ args }) {
    const name = String(args.name)
    const apesArgs = [
      'run', '--as', 'root', '--wait', '--', 'apes', 'agents', 'spawn', name,
    ]
    if (!args['no-bridge']) apesArgs.push('--bridge')
    if (typeof args['bridge-key'] === 'string') apesArgs.push('--bridge-key', args['bridge-key'])
    if (typeof args['bridge-base-url'] === 'string') apesArgs.push('--bridge-base-url', args['bridge-base-url'])
    if (typeof args['bridge-model'] === 'string') apesArgs.push('--bridge-model', args['bridge-model'])

    try {
      execFileSync('apes', apesArgs, { stdio: 'inherit' })
      consola.success(`Nest will pick up ${name} on its next reconcile (≤2s).`)
    }
    catch (err: unknown) {
      const status = (err as { status?: number }).status ?? 1
      throw new CliExit(status)
    }
  },
})
