import { defineCommand } from 'citty'
import { authorizeNestCommand } from './authorize'
import { destroyNestCommand } from './destroy'
import { enrollNestCommand } from './enroll'
import { installNestCommand } from './install'
import { listNestCommand } from './list'
import { spawnNestCommand } from './spawn'
import { statusNestCommand } from './status'
import { uninstallNestCommand } from './uninstall'

export const nestCommand = defineCommand({
  meta: {
    name: 'nest',
    description: 'Manage the local Nest control-plane daemon. One-time setup: `install` (launchd) → `enroll` (own DDISA identity) → `authorize` (YOLO-policy). Day-to-day: `status` / `list` (read-only) and `spawn` / `destroy` (mutating) — every API call is gated by a DDISA grant audited at the IdP, YOLO-approved silently under the policy `apes nest authorize` sets up.',
  },
  subCommands: {
    install: installNestCommand,
    enroll: enrollNestCommand,
    authorize: authorizeNestCommand,
    status: statusNestCommand,
    list: listNestCommand,
    spawn: spawnNestCommand,
    destroy: destroyNestCommand,
    uninstall: uninstallNestCommand,
  },
})
