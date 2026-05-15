import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl, loadAuth } from '../../config'
import { CliError, CliExit } from '../../errors'
import { apiFetch } from '../../http'
import { AGENT_NAME_REGEX, buildDestroyTeardownScript, runPhaseGTeardownInProcess } from '../../lib/agent-bootstrap'
import { isDarwin, readMacOSUser, whichBinary } from '../../lib/macos-user'
import { removeNestAgent } from '../../lib/nest-registry'
import { readPasswordSilent } from '../../lib/silent-password'

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
    'root-stage': {
      type: 'boolean',
      description: 'Internal — destroy.ts re-invokes itself via `apes run --as root --` with this flag set, then runs only the Phase-G teardown (rm home, launchctl bootout, kill processes). Skips IdP + auth + interactive prompts since those already ran in the outer pass.',
    },
  },
  async run({ args }) {
    const name = args.name as string
    if (!AGENT_NAME_REGEX.test(name)) {
      throw new CliError(
        `Invalid agent name "${name}". Must match /^[a-z][a-z0-9-]{0,23}$/.`,
      )
    }

    // Inner re-entry: this process IS root (escapes-setuid'd via the
    // outer `apes run --as root --`). Skip auth + IdP + prompts and
    // just do the privileged ops. The outer pass already removed the
    // IdP record and the nest-registry row by the time it called us.
    if (args['root-stage']) {
      if (process.geteuid?.() !== 0) {
        throw new CliError('--root-stage was passed but this process is not running as root. Refusing to continue.')
      }
      const homeDir = readMacOSUser(name)?.homeDir ?? `/var/openape/homes/${name}`
      consola.start(`Running teardown for ${name} (Phase-G, root-stage)…`)
      runPhaseGTeardownInProcess({ name, homeDir })
      return
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

    const osUser = isDarwin() ? readMacOSUser(name) : null
    const osUserExists = !args['keep-os-user'] && osUser !== null

    if (!idpExists && !osUserExists) {
      consola.info(`Nothing to destroy: no IdP agent and no OS user named "${name}".`)
      return
    }

    if (!args.force) {
      const consequences: string[] = []
      if (osUserExists) {
        const home = osUser?.homeDir ?? `/Users/${name}`
        consequences.push(`• Remove macOS user ${name} and rm -rf ${home}`)
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

    // IdP-side first so the parent's bearer is still fresh. The sudo step
    // below blocks for the password prompt, which the user might take a
    // moment to complete — running the IdP DELETE after a stale-token
    // window would leave the agent record orphaned.
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
      const homeDir = osUser?.homeDir ?? `/Users/${name}`
      const isPhaseG = homeDir.startsWith('/var/openape/homes/')

      if (isPhaseG) {
        // Phase G agents live under /var/openape/homes/ — root via
        // escapes can `rm -rf` the home (no FDA wall on /var/) and
        // bootout the user-domain launchd. The dscl record removal
        // still needs sysadminctl + admin password (escapes' setuid
        // context lacks an audit session, opendirectoryd rejects a
        // plain `dscl . -delete`), so we skip it: the user record
        // becomes a harmless tombstone — uid in the hidden range,
        // IsHidden=1, NFSHomeDirectory pointing at a path that no
        // longer exists. Operators can run `sudo sysadminctl
        // -deleteUser <name>` interactively later if they want full
        // cleanup.
        //
        // Re-enter ourselves as root via `apes run --as root --`
        // instead of writing+executing a temp bash script. The
        // resulting DDISA grant request reads
        //   `apes agents destroy <name> --force --root-stage`
        // which is semantic + matches the existing nest YOLO pattern
        // `apes agents destroy *` for zero-prompt auto-approval.
        // The inner re-entry detects --root-stage and runs just the
        // Phase-G teardown ops via runPhaseGTeardownInProcess().
        if (process.geteuid?.() === 0) {
          // Already root (rare — `apes agents destroy` invoked from
          // inside a setuid-root context like a CI runner with
          // sudo). Do the teardown directly, no second escalation.
          consola.start('Running teardown (Phase G — already root, no grant needed)…')
          runPhaseGTeardownInProcess({ name, homeDir })
        }
        else {
          consola.start('Running teardown (Phase G — no admin password needed)…')
          execFileSync('apes', [
            'run', '--as', 'root', '--wait', '--',
            'apes', 'agents', 'destroy', name, '--force', '--root-stage',
          ], { stdio: 'inherit' })
        }
        consola.info(`dscl record /Users/${name} kept as tombstone (hidden, no home). Run \`sudo sysadminctl -deleteUser ${name}\` to fully remove.`)
      }
      else {
        // Legacy path: home under /Users/, FDA-blocked. Need sudo
        // + admin password to invoke sysadminctl. If we're running
        // headless (no TTY, no APES_ADMIN_PASSWORD) — typical for the
        // troop-WS destroy path from the nest — degrade gracefully:
        // skip the OS-side teardown so the rest of the destroy still
        // proceeds (IdP de-register + nest-registry removal). The
        // dscl record + home dir become orphans; operator cleans up
        // later interactively with `apes agents destroy` from a shell.
        const sudo = whichBinary('sudo')
        if (!sudo) {
          throw new CliError('`sudo` not found on PATH; required for OS teardown.')
        }
        const adminUser = userInfo().username
        let adminPassword: string
        try {
          adminPassword = await collectAdminPassword({ adminUser })
        }
        catch (err) {
          const headless = !process.stdin.isTTY && !process.env.APES_ADMIN_PASSWORD
          if (headless) {
            consola.warn(`Legacy OS teardown for ${name} requires a TTY or APES_ADMIN_PASSWORD; skipping. Run \`apes agents destroy ${name}\` from a shell later to fully clean up /Users/${name} + dscl record.`)
            adminPassword = ''
          }
          else {
            throw err
          }
        }
        if (adminPassword) {
          const scratch = mkdtempSync(join(tmpdir(), `apes-destroy-${name}-`))
          const scriptPath = join(scratch, 'teardown.sh')
          try {
            const script = buildDestroyTeardownScript({ name, homeDir, adminUser })
            writeFileSync(scriptPath, script, { mode: 0o700 })
            consola.start('Running teardown via sudo…')
            execFileSync(sudo, ['-S', '--prompt=', '--', 'bash', scriptPath], {
              input: `${adminPassword}\n${adminPassword}\n`,
              stdio: ['pipe', 'inherit', 'inherit'],
            })
          }
          finally {
            rmSync(scratch, { recursive: true, force: true })
          }
        }
      }
    }
    else if (!args['keep-os-user'] && isDarwin()) {
      consola.info('No macOS user to remove (skipped).')
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

/**
 * Resolve the local admin password used for sudo + `sysadminctl
 * -deleteUser`. Single secret, single prompt:
 *
 *   1. `APES_ADMIN_PASSWORD` env var (CI / orchestrators)
 *   2. Silent terminal prompt (raw-mode stdin, no echo, no mask)
 *   3. Refuse with a clear hint when neither is available
 */
async function collectAdminPassword(opts: { adminUser: string }): Promise<string> {
  const fromEnv = process.env.APES_ADMIN_PASSWORD
  if (fromEnv && fromEnv.length > 0) return fromEnv
  const pw = await readPasswordSilent(`Password for ${opts.adminUser}: `)
  if (pw.length === 0) {
    throw new CliExit(0)
  }
  return pw
}
