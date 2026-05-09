// `apes nest list` — list agents the local nest knows about. Goes
// through the DDISA grant flow: requests a `nest list` grant, YOLO
// auto-approves it, the resulting authz_jwt becomes the Bearer for
// `GET /agents` on the nest daemon.

import process from 'node:process'
import { defineCommand } from 'citty'
import consola from 'consola'
import { CliError } from '../../errors'
import { nestBaseUrl, requestNestGrant } from '../../lib/nest-grant-flow'

interface AgentEntry {
  name: string
  uid: number
  home: string
  email: string
  registeredAt: number
  bridge?: { baseUrl?: string, apiKey?: string, model?: string }
}

export const listNestCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'List agents registered with the local nest. Goes through DDISA grants — YOLO auto-approves under the standard nest policy.',
  },
  args: {
    port: { type: 'string', description: 'Override nest port (default: 9091)' },
    json: { type: 'boolean', description: 'JSON output for scripts' },
  },
  async run({ args }) {
    const token = await requestNestGrant({ command: ['nest', 'list'] })
    const base = nestBaseUrl(args.port ? Number(args.port) : undefined)
    let resp: { agents: AgentEntry[] }
    try {
      const res = await fetch(`${base}/agents`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new CliError(`nest GET /agents failed: ${res.status} ${text}`)
      }
      resp = (await res.json()) as { agents: AgentEntry[] }
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
      console.log(JSON.stringify(resp, null, 2))
      return
    }
    if (resp.agents.length === 0) {
      consola.info('(no agents registered with this nest)')
      return
    }
    consola.info(`${resp.agents.length} agent(s) registered with this nest:`)
    for (const a of resp.agents) {
      const bridge = a.bridge ? ' bridge=on' : ''
      consola.info(`  ${a.name.padEnd(16)} uid=${String(a.uid).padEnd(5)} home=${a.home}${bridge}`)
    }
  },
})
