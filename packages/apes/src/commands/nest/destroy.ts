// `apes nest destroy <name>` — tear down an agent on the local nest
// via the DDISA-protected DELETE /agents/<name>.

import process from 'node:process'
import { defineCommand } from 'citty'
import consola from 'consola'
import { CliError } from '../../errors'
import { nestBaseUrl, requestNestGrant } from '../../lib/nest-grant-flow'

export const destroyNestCommand = defineCommand({
  meta: {
    name: 'destroy',
    description: 'Tear down an agent on the local nest (removes macOS user, hard-deletes IdP record, drops bridge plist). Requires a DDISA `nest destroy <name>` grant.',
  },
  args: {
    name: { type: 'positional', required: true, description: 'Agent name to destroy' },
    port: { type: 'string', description: 'Override nest port (default: 9091)' },
  },
  async run({ args }) {
    const name = String(args.name)
    const token = await requestNestGrant({ command: ['nest', 'destroy', name] })
    const base = nestBaseUrl(args.port ? Number(args.port) : undefined)
    try {
      const res = await fetch(`${base}/agents/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new CliError(`nest DELETE /agents/${name} failed: ${res.status} ${text}`)
      }
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

    consola.success(`Destroyed ${name}`)
  },
})
