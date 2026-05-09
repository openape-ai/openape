// `apes nest spawn <name>` — provision a new agent on the local nest
// via the DDISA-protected POST /agents. The grant flow grants
// command=['nest','spawn','<name>'] (so each agent name is its own
// grant; revoking one doesn't revoke others).

import process from 'node:process'
import { defineCommand } from 'citty'
import consola from 'consola'
import { CliError } from '../../errors'
import { nestBaseUrl, requestNestGrant } from '../../lib/nest-grant-flow'

interface SpawnResponse {
  name: string
  email: string
  uid: number
  home: string
}

export const spawnNestCommand = defineCommand({
  meta: {
    name: 'spawn',
    description: 'Spawn a new agent on the local nest. Requires a DDISA `nest spawn <name>` grant — auto-approved by Patrick\'s policy on first use, reused on subsequent calls.',
  },
  args: {
    name: { type: 'positional', required: true, description: 'Agent name (lowercase, [a-z0-9-], max 24 chars)' },
    'no-bridge': { type: 'boolean', description: 'Skip installing the chat-bridge daemon (default: install it)' },
    'bridge-key': { type: 'string', description: 'Override LITELLM_API_KEY (default: read from ~/litellm/.env)' },
    'bridge-base-url': { type: 'string', description: 'Override LITELLM_BASE_URL (default: read from ~/litellm/.env)' },
    'bridge-model': { type: 'string', description: 'Override APE_CHAT_BRIDGE_MODEL' },
    'port': { type: 'string', description: 'Override nest port (default: 9091)' },
  },
  async run({ args }) {
    const name = String(args.name)
    // Grant command is `nest spawn` (no name) — one human approval
    // grants reuse for any future spawn. The actual agent name is
    // carried in the request body. Trade-off: a compromised local
    // process running as Patrick can spawn arbitrary agents under
    // this single grant. Acceptable because spawn is reversible
    // (`apes nest destroy`) and creates auditable IdP records.
    // For destructive ops we keep per-name grants.
    const token = await requestNestGrant({ command: ['nest', 'spawn'] })
    const base = nestBaseUrl(args.port ? Number(args.port) : undefined)
    const reqBody: Record<string, unknown> = {
      name,
      bridge: !args['no-bridge'],
    }
    if (typeof args['bridge-key'] === 'string') reqBody.bridgeKey = args['bridge-key']
    if (typeof args['bridge-base-url'] === 'string') reqBody.bridgeBaseUrl = args['bridge-base-url']
    if (typeof args['bridge-model'] === 'string') reqBody.bridgeModel = args['bridge-model']

    let resp: SpawnResponse
    try {
      const res = await fetch(`${base}/agents`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(reqBody),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new CliError(`nest POST /agents failed: ${res.status} ${text}`)
      }
      resp = (await res.json()) as SpawnResponse
    }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
        consola.error(`Nest daemon is not running at ${base}`)
        consola.info('  Run:  apes nest install')
        process.exit(2)
      }
      throw err
    }

    consola.success(`Spawned ${resp.name} (uid=${resp.uid}, home=${resp.home})`)
  },
})
