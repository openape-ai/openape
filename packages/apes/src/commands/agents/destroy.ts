import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl, loadAuth } from '../../config'
import { CliError, CliExit } from '../../errors'
import { apiFetch } from '../../http'
import { AGENT_NAME_REGEX } from '../../lib/agent-bootstrap'
import { getHostPlatform } from '../../lib/host-platform'
import { removeNestAgent } from '../../lib/nest-registry'

interface IdpUser {
  email: string
  name: string
  owner: string | null
  isActive: boolean
}

export const destroyAgentCommand = defineCommand({
  meta: {
    name: 'destroy',
    description: 'Tear down an agent: remove the OS user, hard-delete IdP agent, drop all SSH keys',
  },
  args: {
    name: {
      type: 'positional',
      description: 'Agent name to destroy',
      required: true,
    },
    force: {
      type: 'boolean',
      description: 'Skip the interactive confirmation. Required for CI.',
    },
    soft: {
      type: 'boolean',
      description: 'Soft deactivate at the IdP (PATCH isActive=false) instead of hard-delete',
    },
    'keep-os-user': {
      type: 'boolean',
      description: 'Skip OS-side teardown. Useful for CI where the agent has no OS user.',
    },
  },
  async run({ args }) {
    const name = args.name as string
    if (!AGENT_NAME_REGEX.test(name)) {
      throw new CliError(
        `Invalid agent name "${name}". Must match /^[a-z][a-z0-9-]{0,23}$/.`,
      )
    }

    const auth = loadAuth()
    if (!auth) {
      throw new CliError('Not authenticated. Run `apes login` first.')
    }
    const idp = getIdpUrl()
    if (!idp) {
      throw new CliError('No IdP URL configured. Run `apes login` first.')
    }

    const owned = await apiFetch<IdpUser[]>('/api/my-agents', { idp })
    const idpAgent = owned.find(u => u.name === name)
    const idpExists = idpAgent !== undefined

    const osUser = getHostPlatform().lookupAgentUser(name)
    const osUserExists = !args['keep-os-user'] && osUser !== null

    if (!idpExists && !osUserExists) {
      consola.info(`Nothing to destroy: no IdP agent and no OS user for "${name}".`)
      return
    }

    if (!args.force) {
      const consequences: string[] = []
      if (osUserExists) {
        const home = osUser?.homeDir ?? `/home/${name}`
        consequences.push(`• Remove OS user ${osUser?.name ?? name} and rm -rf ${home}`)
      }
      if (idpExists) {
        consequences.push(args.soft
          ? `• Deactivate IdP agent ${idpAgent!.email} (PATCH isActive=false)`
          : `• Hard-delete IdP agent ${idpAgent!.email} and all its SSH keys`)
      }
      consola.warn(`About to destroy "${name}":\n${consequences.join('\n')}`)
      // Without a TTY, consola.prompt would crash with `uv_tty_init returned
      // EINVAL` and leave the user with an opaque stack trace. Detect and
      // refuse with a clear hint instead — `--force` is the explicit
      // non-interactive path (CI, subprocess invocations, this script's
      // own caller when piped).
      if (!process.stdin.isTTY) {
        throw new CliError(
          'No TTY available for the interactive confirmation. Re-run with --force '
          + 'to skip the prompt (this is the same flag CI uses).',
        )
      }
      const confirmed = await consola.prompt('Proceed?', { type: 'confirm', initial: false })
      if (typeof confirmed === 'symbol' || !confirmed) {
        throw new CliExit(0)
      }
    }

    // IdP-side first so the parent's bearer is still fresh. The OS-side
    // teardown below may take a moment; running the IdP DELETE after a
    // stale-token window would leave the agent record orphaned.
    if (idpExists) {
      const id = encodeURIComponent(idpAgent!.email)
      if (args.soft) {
        await apiFetch(`/api/my-agents/${id}`, { method: 'PATCH', body: { isActive: false }, idp })
        consola.success(`Deactivated IdP agent ${idpAgent!.email}`)
      }
      else {
        await apiFetch(`/api/my-agents/${id}`, { method: 'DELETE', idp })
        consola.success(`Deleted IdP agent ${idpAgent!.email}`)
      }
    }
    else {
      consola.info('No IdP agent to remove (skipped).')
    }

    // OS-side teardown: kill any leftover processes owned by the agent
    // user, then `userdel -r` to drop the account and its home. Guarded
    // by getent so a missing user is a no-op (idempotent). Skipped
    // entirely when `--keep-os-user` is set.
    if (osUserExists) {
      consola.start(`Removing OS user ${name}…`)
      await getHostPlatform().runPrivilegedBash(
        `#!/bin/bash\nset -euo pipefail\nif getent passwd ${JSON.stringify(name)} >/dev/null 2>&1; then\n  pkill -9 -u ${JSON.stringify(name)} 2>/dev/null || true\n  userdel -r ${JSON.stringify(name)}\nfi\n`,
      )
      consola.success(`Removed OS user ${name}.`)
    }

    // Phase F: drop the entry from the Nest's registry. The Nest's
    // file-watcher reconciles its pm2-supervisor → bridge gets pm2-
    // deleted automatically.
    try { removeNestAgent(name) }
    catch (err) {
      consola.warn(`Could not update nest registry: ${err instanceof Error ? err.message : String(err)}`)
    }

    consola.success(`Destroyed ${name}.`)
  },
})
