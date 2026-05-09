import { defineCommand } from 'citty'
import { authorizeNestCommand } from './authorize'
import { enrollNestCommand } from './enroll'
import { installNestCommand } from './install'
import { statusNestCommand } from './status'
import { uninstallNestCommand } from './uninstall'

export const nestCommand = defineCommand({
  meta: {
    name: 'nest',
    description: 'Manage the local Nest control-plane daemon (install / enroll / authorize / status / uninstall). One-time setup: `install` (launchd) → `enroll` (own DDISA identity) → `authorize` (YOLO-policy). After that, `apes agents spawn` runs without per-call DDISA approvals.',
  },
  subCommands: {
    install: installNestCommand,
    enroll: enrollNestCommand,
    authorize: authorizeNestCommand,
    status: statusNestCommand,
    uninstall: uninstallNestCommand,
  },
})
