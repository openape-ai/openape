import { clearSpToken } from '@openape/cli-auth'
import type { SpClient, SpClientState } from '@openape/cli-auth'
import { defineCommand } from 'citty'
import { existsSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ProofCliDescriptor } from '../descriptor'
import { info } from '../output'

/**
 * Drop the cached SP-token for this app's endpoint. Doesn't touch the IdP
 * session — that's owned by `apes login` / `apes logout`. `--legacy` also
 * deletes the pre-1.0 `~/.openape/<configFile>` if it's still around.
 */
export function makeLogoutCommand(
  d: Pick<ProofCliDescriptor, 'name' | 'aud' | 'configFile'>,
  client: SpClient<SpClientState>,
) {
  return defineCommand({
    meta: {
      name: 'logout',
      description: `Forget the cached ${d.name} SP-token (does NOT log you out of \`apes\`).`,
    },
    args: {
      endpoint: { type: 'string', description: `Override ${d.name} endpoint.` },
      legacy: { type: 'boolean', description: `Also delete the legacy ~/.openape/${d.configFile} file.` },
    },
    async run({ args }) {
      const endpoint = client.resolveEndpoint(args.endpoint)
      const aud = (() => {
        try { return new URL(endpoint).host }
        catch { return d.aud }
      })()
      clearSpToken(aud)
      info(`Cleared ${d.name} SP-token cache for ${endpoint}.`)

      if (args.legacy) {
        const legacy = join(homedir(), '.openape', d.configFile)
        if (existsSync(legacy)) {
          unlinkSync(legacy)
          info(`Removed legacy ${legacy}.`)
        }
        else {
          info(`No legacy ${d.configFile} to remove.`)
        }
      }

      info('IdP session (~/.config/apes/auth.json) untouched. Run `apes logout` to clear it.')
    },
  })
}
