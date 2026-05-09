import { defineCommand } from 'citty'
import { authorizeNestCommand } from './authorize'
import { installNestCommand } from './install'
import { statusNestCommand } from './status'
import { uninstallNestCommand } from './uninstall'

export const nestCommand = defineCommand({
  meta: {
    name: 'nest',
    description: 'Manage the local Nest control-plane daemon (install, authorize, status, uninstall). The Nest hosts agents on this computer — once installed + authorized, `apes agents spawn` is fast (no per-spawn DDISA approvals) and per-agent launchd plists are replaced by a single supervised process tree.',
  },
  subCommands: {
    install: installNestCommand,
    authorize: authorizeNestCommand,
    status: statusNestCommand,
    uninstall: uninstallNestCommand,
  },
})
