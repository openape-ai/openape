import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
      const confirmed = await consola.prompt('Proceed?', { type: 'confirm', initial: false })
      if (typeof confirmed === 'symbol' || !confirmed) {
        throw new CliExit(0)
      }
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
      const scratch = mkdtempSync(join(tmpdir(), `apes-destroy-${name}-`))
      const scriptPath = join(scratch, 'teardown.sh')
      try {
        const script = buildDestroyTeardownScript({ name, homeDir: `/Users/${name}` })
        writeFileSync(scriptPath, script, { mode: 0o700 })
        consola.start('Running teardown as root via `apes run --as root`…')
        consola.info('You will be asked to approve the as=root grant in your DDISA inbox.')
        execFileSync(apes, ['run', '--as', 'root', '--', 'bash', scriptPath], { stdio: 'inherit' })
      }
      finally {
        rmSync(scratch, { recursive: true, force: true })
      }
    }
    else if (!args['keep-os-user'] && isDarwin()) {
      consola.info('No macOS user to remove (skipped).')
    }

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

    consola.success(`Destroyed ${name}.`)
  },
})
