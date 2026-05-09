// `apes nest status` — quick health check for the local nest-daemon.
// Goes through the DDISA grant flow with a `nest status` grant; YOLO
// auto-approves under the standard nest policy.

import process from 'node:process'
import { defineCommand } from 'citty'
import consola from 'consola'
import { CliError } from '../../errors'
import { nestBaseUrl, requestNestGrant } from '../../lib/nest-grant-flow'

interface NestStatus {
  agents: number
}

export const statusNestCommand = defineCommand({
  meta: {
    name: 'status',
    description: 'Print health of the local nest-daemon (agents registered). Goes through DDISA grants.',
  },
  args: {
    port: { type: 'string', description: 'Override nest port (default: 9091)' },
    json: { type: 'boolean', description: 'JSON output for scripts' },
  },
  async run({ args }) {
    const token = await requestNestGrant({ command: ['nest', 'status'] })
    const base = nestBaseUrl(args.port ? Number(args.port) : undefined)
    let status: NestStatus
    try {
      const res = await fetch(`${base}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new CliError(`nest GET /status failed: ${res.status} ${text}`)
      }
      status = (await res.json()) as NestStatus
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

    if (args.json) {
      console.log(JSON.stringify(status, null, 2))
      return
    }
    consola.info(`Nest at ${base} — ${status.agents} agent(s) registered`)
  },
})
