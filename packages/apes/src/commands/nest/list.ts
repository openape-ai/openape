// `apes nest list` — Phase D: file-based intent.

import { defineCommand } from 'citty'
import consola from 'consola'
import { dispatchIntent } from '../../lib/nest-intent'

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
    description: 'List agents registered with the local nest. File-based intent.',
  },
  args: {
    json: { type: 'boolean', description: 'JSON output for scripts' },
  },
  async run({ args }) {
    const result = await dispatchIntent<{ agents: AgentEntry[] }>({ action: 'list' })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (result.agents.length === 0) {
      consola.info('(no agents registered with this nest)')
      return
    }
    consola.info(`${result.agents.length} agent(s) registered with this nest:`)
    for (const a of result.agents) {
      const bridge = a.bridge ? ' bridge=on' : ''
      consola.info(`  ${a.name.padEnd(16)} uid=${String(a.uid).padEnd(5)} home=${a.home}${bridge}`)
    }
  },
})
