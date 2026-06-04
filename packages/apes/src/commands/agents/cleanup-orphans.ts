import { defineCommand } from 'citty'
import consola from 'consola'
import { getHostPlatform } from '../../lib/host-platform'

/**
 * Report leftover agent-user tombstones from `apes agents destroy`.
 *
 * On Linux `userdel -r` removes the OS user and its home directory in a
 * single atomic operation, so a destroy never leaves a half-deleted user
 * record behind — there is nothing to sweep. This command stays for
 * parity with the operator's muscle-memory and simply reports clean.
 * `listOrphanAgentUsers()` returns an empty list on Linux; the non-empty
 * branch is future-proofing only.
 */
export const cleanupOrphansCommand = defineCommand({
  meta: {
    name: 'cleanup-orphans',
    description: 'Report agent-user tombstones. Linux userdel is atomic, so there are normally none.',
  },
  args: {
    'dry-run': {
      type: 'boolean',
      description: 'List orphans without deleting.',
    },
    'force': {
      type: 'boolean',
      description: 'Skip the interactive confirmation. Required when stdin is not a TTY.',
    },
  },
  async run() {
    const orphans = getHostPlatform().listOrphanAgentUsers()
    if (orphans.length === 0) {
      consola.success('No agent tombstones — userdel is clean on Linux.')
      return
    }

    consola.warn(`Found ${orphans.length} unexpected agent tombstone${orphans.length === 1 ? '' : 's'}:`)
    for (const o of orphans) {
      console.log(`  • ${o.name}${o.uid !== null ? ` (uid=${o.uid})` : ''} — was ${o.homeDir}`)
    }
    consola.info('Remove each one manually with `userdel -r <name>`.')
  },
})
