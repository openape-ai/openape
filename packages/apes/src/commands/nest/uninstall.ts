// `apes nest uninstall` — stop + remove the nest-daemon supervisor unit.
// Doesn't touch the registered agents or their OS users — they stay;
// only the supervisor goes away. After uninstall, agents can still be
// re-supervised by re-installing later (registry persists at
// ~/.openape/nest/agents.json).

import { defineCommand } from 'citty'
import consola from 'consola'
import { getHostPlatform } from '../../lib/host-platform'

export const uninstallNestCommand = defineCommand({
  meta: {
    name: 'uninstall',
    description: 'Stop + remove the local nest-daemon (registry + agents preserved)',
  },
  async run() {
    await getHostPlatform().uninstallNestSupervisor()
    consola.success('Nest daemon stopped + supervisor unit removed')
    consola.info('Registry at ~/.openape/nest/agents.json kept — re-run `apes nest install` to resume supervision.')
  },
})
