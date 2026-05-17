import { defineCommand } from 'citty'
import { sessionsListCommand } from './list'
import { sessionsRemoveCommand } from './remove'

/**
 * `apes sessions …` — manage your own refresh-token families across
 * devices. One family per `apes login`. Use `list` to see what's active,
 * `remove <familyId>` to revoke a stale device.
 */
export const sessionsCommand = defineCommand({
  meta: {
    name: 'sessions',
    description: 'Manage your active refresh-token sessions across devices',
  },
  subCommands: {
    list: sessionsListCommand,
    remove: sessionsRemoveCommand,
  },
})
