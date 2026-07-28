import type { SpClient, SpClientState } from '@openape/cli-auth'
import { defineCommand } from 'citty'
import type { ProofCliDescriptor } from '../descriptor'
import { printJson, printLine } from '../output'

/**
 * Print the current caller identity as seen by the server.
 *
 * EXAMPLE
 *   $ ape-<app> whoami
 *   patrick@example.com (human)  endpoint https://<app>.openape.ai
 */
export function makeWhoamiCommand(
  d: Pick<ProofCliDescriptor, 'name'>,
  client: SpClient<SpClientState>,
) {
  return defineCommand({
    meta: {
      name: 'whoami',
      description: 'Show the current session identity (email, act, endpoint).',
    },
    args: {
      json: { type: 'boolean', description: 'JSON output.' },
      endpoint: { type: 'string', description: `Override ${d.name} endpoint.` },
    },
    async run({ args }) {
      const endpoint = client.resolveEndpoint(args.endpoint)
      const me = await client.apiCall<{ email: string, act: 'human' | 'agent' }>(
        '/api/cli/me',
        { method: 'GET', endpoint },
      )
      const email = me.email ?? 'unknown'
      const act = me.act ?? 'human'

      if (args.json) {
        printJson({ email, act, endpoint })
        return
      }
      printLine(`${email} (${act})  endpoint ${endpoint}`)
    },
  })
}
