// `apes nest spawn <name>` — Phase D (#sim-arch): drops an intent
// file into the Nest's intents/ directory and waits for the response.
// No HTTP call, no DDISA grant per spawn (the legacy HTTP path
// required a `nest spawn` grant that humans had no YOLO for, so each
// spawn would have re-prompted; the dir-based intent uses UNIX
// permissions instead — the dir is mode 770 group=_openape_nest, and
// Patrick is in that group via the migrate-to-service-user step).

import { defineCommand } from 'citty'
import consola from 'consola'
import { dispatchIntent } from '../../lib/nest-intent'

interface SpawnResponse {
  name: string
  email: string
  uid: number
  home: string
}

export const spawnNestCommand = defineCommand({
  meta: {
    name: 'spawn',
    description: 'Spawn a new agent on the local nest. Drops an intent file the nest daemon picks up; UNIX permissions on the intents dir gate access.',
  },
  args: {
    name: { type: 'positional', required: true, description: 'Agent name (lowercase, [a-z0-9-], max 24 chars)' },
    'no-bridge': { type: 'boolean', description: 'Skip installing the chat-bridge daemon (default: install it)' },
    'bridge-key': { type: 'string', description: 'Override LITELLM_API_KEY (default: read from ~/litellm/.env)' },
    'bridge-base-url': { type: 'string', description: 'Override LITELLM_BASE_URL (default: read from ~/litellm/.env)' },
    'bridge-model': { type: 'string', description: 'Override APE_CHAT_BRIDGE_MODEL' },
  },
  async run({ args }) {
    const name = String(args.name)
    const intent: Record<string, unknown> = {
      action: 'spawn',
      name,
      bridge: !args['no-bridge'],
    }
    if (typeof args['bridge-key'] === 'string') intent.bridgeKey = args['bridge-key']
    if (typeof args['bridge-base-url'] === 'string') intent.bridgeBaseUrl = args['bridge-base-url']
    if (typeof args['bridge-model'] === 'string') intent.bridgeModel = args['bridge-model']

    const result = await dispatchIntent<SpawnResponse>(intent)
    consola.success(`Spawned ${result.name} (uid=${result.uid}, home=${result.home})`)
  },
})
