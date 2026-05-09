// `apes nest uninstall` — bootout + remove the nest-daemon's launchd
// plist. Doesn't touch the registered agents or their macOS users —
// they stay; only the supervisor goes away. After uninstall, agents
// can still be re-supervised by re-installing later (registry persists
// at ~/.openape/nest/agents.json).

import { execFileSync } from 'node:child_process'
import { existsSync, unlinkSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { defineCommand } from 'citty'
import consola from 'consola'

const PLIST_LABEL = 'ai.openape.nest'

export const uninstallNestCommand = defineCommand({
  meta: {
    name: 'uninstall',
    description: 'Stop + remove the local nest-daemon (registry + agents preserved)',
  },
  async run() {
    const uid = userInfo().uid
    const path = join(homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`)
    try {
      execFileSync('/bin/launchctl', ['bootout', `gui/${uid}/${PLIST_LABEL}`], { stdio: 'ignore' })
      consola.success('Nest daemon stopped')
    }
    catch {
      consola.info('Nest daemon was not loaded')
    }
    if (existsSync(path)) {
      unlinkSync(path)
      consola.success(`Removed ${path}`)
    }
    consola.info('Registry at ~/.openape/nest/agents.json kept — re-run `apes nest install` to resume supervision.')
  },
})
