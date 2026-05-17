import { defineCommand } from 'citty'
import { authorizeNestCommand } from './authorize'
import { destroyNestCommand } from './destroy'
import { enrollNestCommand } from './enroll'
import { installNestCommand } from './install'
import { listNestCommand } from './list'
import { spawnNestCommand } from './spawn'
import { uninstallNestCommand } from './uninstall'

export const nestCommand = defineCommand({
  meta: {
    name: 'nest',
    description: 'Manage the local Nest control-plane daemon. One-time setup: `install` → `enroll` → `authorize`. Day-to-day: `list` / `spawn` / `destroy`. As of Phase D the Nest is a long-running CLIENT — commands talk to it via filesystem intent files in $NEST_HOME/intents (mode 770, group _openape_nest) instead of HTTP.',
  },
  subCommands: {
    install: installNestCommand,
    enroll: enrollNestCommand,
    authorize: authorizeNestCommand,
    list: listNestCommand,
    spawn: spawnNestCommand,
    destroy: destroyNestCommand,
    uninstall: uninstallNestCommand,
  },
})
