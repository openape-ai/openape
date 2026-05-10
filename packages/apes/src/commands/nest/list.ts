// `apes nest list` — Phase F: read the registry directly. No
// inter-process communication needed; the file is shared between
// Nest + apes-cli (mode 660 group _openape_nest, Patrick is in the
// group post-migration).

import { defineCommand } from 'citty'
import consola from 'consola'
import { readNestRegistry } from '../../lib/nest-registry'

export const listNestCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'List agents registered with the local nest. Reads /var/openape/nest/agents.json directly.',
  },
  args: {
    json: { type: 'boolean', description: 'JSON output for scripts' },
  },
  async run({ args }) {
    const reg = readNestRegistry()
    if (args.json) {
      console.log(JSON.stringify(reg, null, 2))
      return
    }
    if (reg.agents.length === 0) {
      consola.info('(no agents registered with this nest)')
      return
    }
    consola.info(`${reg.agents.length} agent(s) registered with this nest:`)
    for (const a of reg.agents) {
      const bridge = a.bridge ? ' bridge=on' : ''
      consola.info(`  ${a.name.padEnd(16)} uid=${String(a.uid).padEnd(5)} home=${a.home}${bridge}`)
    }
  },
})
