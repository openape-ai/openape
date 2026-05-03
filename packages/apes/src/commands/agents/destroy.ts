import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl, loadAuth } from '../../config'
import { CliError, CliExit } from '../../errors'
import { apiFetch } from '../../http'
import { AGENT_NAME_REGEX, buildDestroyTeardownScript } from '../../lib/agent-bootstrap'
import { isDarwin, readMacOSUser, whichBinary } from '../../lib/macos-user'

interface IdpUser {
  email: string
  name: string
  owner: string | null
  isActive: boolean
}

export const destroyAgentCommand = defineCommand({
  meta: {
    name: 'destroy',
    description: 'Tear down an agent: remove macOS user, hard-delete IdP agent, drop all SSH keys',
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

    const osUserExists = !args['keep-os-user'] && isDarwin() && readMacOSUser(name) !== null

    if (!idpExists && !osUserExists) {
      consola.info(`Nothing to destroy: no IdP agent and no OS user named "${name}".`)
      return
    }

    if (!args.force) {
      const consequences: string[] = []
      if (osUserExists) consequences.push(`• Remove macOS user ${name} and rm -rf /Users/${name}`)
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

    // IdP-side first: while the parent's bearer is still fresh from preflight.
    // The escapes step below blocks for human approval, which can take longer
    // than the token's TTL — running the IdP DELETE after that wait would
    // surface a stale-token error and leave the agent record orphaned.
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

    if (osUserExists) {
      const apes = whichBinary('apes')
      if (!apes) {
        throw new CliError('`apes` not found on PATH. Install @openape/apes globally first.')
      }
      const escapes = whichBinary('escapes')
      if (!escapes) {
        throw new CliError('`escapes` not found on PATH; OS teardown requires escapes.')
      }

      // The teardown script runs in escapes' setuid-root context, which
      // has no audit/PAM session attached. Bare `sysadminctl -deleteUser`
      // and `dscl . -delete` hang ~5min then fail with -14987 from there.
      // sysadminctl with explicit -adminUser/-adminPassword bypasses that
      // path, so we collect the local admin password here and pipe it to
      // the script via stdin (never as argv — it would show up in `ps`
      // and in escapes' audit log).
      const adminUser = userInfo().username
      const adminPassword = await collectAdminPassword({ adminUser, force: !!args.force })

      const scratch = mkdtempSync(join(tmpdir(), `apes-destroy-${name}-`))
      const scriptPath = join(scratch, 'teardown.sh')
      try {
        const script = buildDestroyTeardownScript({ name, homeDir: `/Users/${name}`, adminUser })
        writeFileSync(scriptPath, script, { mode: 0o700 })
        consola.start('Running teardown as root via `apes run --as root --wait`…')
        consola.info('You will be asked to approve the as=root grant in your DDISA inbox; this command blocks until you do.')
        // --wait makes the call synchronous; without it `apes run --as root`
        // returns exit 75 (pending) immediately, leaving a dangling grant.
        // input + stdio[0]='pipe' streams the password into bash's stdin
        // so the teardown's `read -r ADMIN_PASSWORD` consumes it.
        execFileSync(apes, ['run', '--as', 'root', '--wait', '--', 'bash', scriptPath], {
          input: `${adminPassword}\n`,
          stdio: ['pipe', 'inherit', 'inherit'],
        })
      }
      finally {
        rmSync(scratch, { recursive: true, force: true })
      }
    }
    else if (!args['keep-os-user'] && isDarwin()) {
      consola.info('No macOS user to remove (skipped).')
    }

    consola.success(`Destroyed ${name}.`)
  },
})

/**
 * Collect the local admin password used for the `sysadminctl -deleteUser
 * -adminUser <u> -adminPassword <p>` call inside the teardown script.
 *
 * Resolution order:
 *   1. `APES_ADMIN_PASSWORD` env var (always preferred — lets CI and
 *      orchestrators script the destroy without a TTY).
 *   2. Interactive prompt (silent) when stdin is a TTY.
 *   3. Refuse with a clear hint when neither is available.
 *
 * `--force` skips the confirmation prompt earlier in the flow but does
 * NOT skip this step: there's no safe non-interactive default for an
 * admin credential, and silent failure here would be a regression
 * compared to the prior `sudo -n` attempt that at least surfaced an
 * error.
 */
async function collectAdminPassword(opts: { adminUser: string, force: boolean }): Promise<string> {
  const fromEnv = process.env.APES_ADMIN_PASSWORD
  if (fromEnv && fromEnv.length > 0) return fromEnv

  if (!process.stdin.isTTY) {
    throw new CliError(
      `Admin password required for sysadminctl -deleteUser. No TTY available `
      + `for the silent prompt; set APES_ADMIN_PASSWORD in the environment `
      + `(local admin password for ${opts.adminUser}). The teardown reads it `
      + `from stdin and never stores it.`,
    )
  }

  consola.info(`Local admin password for ${opts.adminUser} (used for sysadminctl -deleteUser; not stored):`)
  const pw = await consola.prompt('Admin password', { type: 'text', mask: '*' })
  if (typeof pw === 'symbol' || !pw || pw.length === 0) {
    throw new CliExit(0)
  }
  return pw as string
}
