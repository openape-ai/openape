import { execFileSync } from 'node:child_process'
import { defineCommand } from 'citty'
import consola from 'consola'
import { CliError } from '../../errors'
import { isDarwin, listOrphanedAgentRecords } from '../../lib/macos-user'

/**
 * Sweep accumulated agent-user tombstones left behind by
 * `apes agents destroy`. opendirectoryd refuses `dscl . -delete` from
 * escapes' setuid-root context (the audit-session is unset, so it
 * cannot verify admin authorisation), but accepts `sysadminctl
 * -deleteUser` when invoked under an interactive `sudo` session
 * because that inherits the operator's admin audit-session.
 *
 * Detection rule: any dscl user record whose NFSHomeDirectory is
 * under `/var/openape/homes/` OR whose name starts with
 * `openape-agent-`, AND whose home dir is missing on disk. The
 * combination is unambiguous — Phase G+ agents always put homes
 * under that path, and the prefix narrows it further once all
 * agents are migrated.
 *
 * Run as: `sudo apes agents cleanup-orphans` (interactive admin
 * session required). The command refuses to proceed when not root.
 */
export const cleanupOrphansCommand = defineCommand({
  meta: {
    name: 'cleanup-orphans',
    description: 'Delete tombstoned macOS user records left behind by `apes agents destroy` (run with sudo).',
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
  async run({ args }) {
    if (!isDarwin()) {
      throw new CliError(`\`apes agents cleanup-orphans\` is macOS-only. Detected platform: ${process.platform}.`)
    }

    const orphans = listOrphanedAgentRecords()
    if (orphans.length === 0) {
      consola.success('No agent tombstones found — dscl is clean.')
      return
    }

    consola.info(`Found ${orphans.length} agent tombstone${orphans.length === 1 ? '' : 's'}:`)
    for (const o of orphans) {
      console.log(`  • ${o.name}${o.uid !== null ? ` (uid=${o.uid})` : ''} — was ${o.homeDir}`)
    }

    if (args['dry-run']) {
      consola.info('Dry-run — no records deleted. Re-run without --dry-run to clean up.')
      return
    }

    if (process.geteuid?.() !== 0) {
      throw new CliError(
        'Must run as root so opendirectoryd accepts the sysadminctl-deleteUser calls. '
        + 'Re-run with `sudo apes agents cleanup-orphans` from a shell login (the sudo '
        + 'session inherits your admin audit-session, which opendirectoryd verifies).',
      )
    }

    if (!args.force) {
      if (!process.stdin.isTTY) {
        throw new CliError(
          'No TTY available for the interactive confirmation. Re-run with --force '
          + '(this is the same flag CI / scripted callers use).',
        )
      }
      const confirmed = await consola.prompt(`Delete ${orphans.length} tombstone${orphans.length === 1 ? '' : 's'}?`, {
        type: 'confirm',
        initial: false,
      })
      if (typeof confirmed === 'symbol' || !confirmed) {
        consola.info('Aborted — no records deleted.')
        return
      }
    }

    let deleted = 0
    let failed = 0
    for (const o of orphans) {
      try {
        execFileSync('/usr/sbin/sysadminctl', ['-deleteUser', o.name], {
          stdio: ['ignore', 'inherit', 'inherit'],
        })
        consola.success(`Deleted ${o.name}`)
        deleted++
      }
      catch (err) {
        consola.warn(`Failed to delete ${o.name}: ${err instanceof Error ? err.message : String(err)}`)
        failed++
      }
    }

    if (failed > 0) {
      throw new CliError(`Cleanup finished with errors: ${deleted} deleted, ${failed} failed.`)
    }
    consola.success(`Cleanup complete — ${deleted} tombstone${deleted === 1 ? '' : 's'} removed.`)
  },
})
