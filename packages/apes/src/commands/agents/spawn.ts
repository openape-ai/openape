import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl, loadAuth } from '../../config'
import { CliError } from '../../errors'
import {
  AGENT_NAME_REGEX,
  BASH_VIA_APE_SHELL_HOOK_SOURCE,
  buildAgentAuthJson,
  buildSpawnSetupScript,
  CLAUDE_SETTINGS_JSON,
  issueAgentToken,
  registerAgentAtIdp,
} from '../../lib/agent-bootstrap'
import { generateKeyPairInMemory } from '../../lib/keygen'
import { isDarwin, isShellRegistered, readMacOSUser, whichBinary } from '../../lib/macos-user'

export const spawnAgentCommand = defineCommand({
  meta: {
    name: 'spawn',
    description: 'Provision a local macOS agent end-to-end (OS user, keypair, IdP agent, ape-shell, Claude hook)',
  },
  args: {
    name: {
      type: 'positional',
      description: 'Agent name — also the macOS short username (lowercase, [a-z0-9-], must start with a letter)',
      required: true,
    },
    shell: {
      type: 'string',
      description: 'Override login shell. Default: $(which ape-shell)',
    },
    'no-claude-hook': {
      type: 'boolean',
      description: 'Skip writing ~/.claude/settings.json + the Bash-rewrite hook',
    },
  },
  async run({ args }) {
    const name = args.name as string
    if (!AGENT_NAME_REGEX.test(name)) {
      throw new CliError(
        `Invalid agent name "${name}". Must match /^[a-z][a-z0-9-]{0,23}$/ — `
        + `lowercase letters, digits and hyphens, 1–24 chars, must start with a letter.`,
      )
    }

    if (!isDarwin()) {
      throw new CliError(
        `\`apes agents spawn\` is currently macOS-only. Detected platform: ${process.platform}. `
        + `Linux support is a follow-up; for now, use \`apes agents register\` plus a manually provisioned user.`,
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

    const apeShell = args.shell ?? whichBinary('ape-shell')
    if (!apeShell) {
      throw new CliError('`ape-shell` not found on PATH. Install @openape/apes globally first.')
    }
    const apes = whichBinary('apes')
    if (!apes) {
      throw new CliError('`apes` not found on PATH. Install @openape/apes globally first.')
    }
    const escapes = whichBinary('escapes')
    if (!escapes) {
      throw new CliError(
        '`escapes` not found on PATH. spawn delegates the privileged setup phase to escapes; '
        + 'install it before running spawn.',
      )
    }
    if (!isShellRegistered(apeShell)) {
      throw new CliError(
        `${apeShell} is not registered in /etc/shells. macOS refuses to set it as a login shell. Run:\n`
        + `  echo ${apeShell} | sudo tee -a /etc/shells\n`
        + 'and try again.',
      )
    }

    const existing = readMacOSUser(name)
    if (existing) {
      throw new CliError(`macOS user "${name}" already exists (uid=${existing.uid ?? '?'}). Refusing to overwrite.`)
    }

    const homeDir = `/Users/${name}`
    const scratch = mkdtempSync(join(tmpdir(), `apes-spawn-${name}-`))
    const scriptPath = join(scratch, 'setup.sh')

    try {
      consola.start(`Generating keypair for ${name}…`)
      const { privatePem, publicSshLine } = generateKeyPairInMemory()

      consola.start(`Registering agent at ${idp}…`)
      const registration = await registerAgentAtIdp({ name, publicKey: publicSshLine, idp })
      consola.success(`Registered as ${registration.email}`)

      consola.start('Issuing agent access token…')
      const { token, expiresIn } = await issueAgentToken({
        idp,
        agentEmail: registration.email,
        privateKeyPem: privatePem,
      })

      const authJson = buildAgentAuthJson({
        idp,
        accessToken: token,
        email: registration.email,
        expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
      })

      const includeClaudeHook = !args['no-claude-hook']
      const script = buildSpawnSetupScript({
        name,
        homeDir,
        shellPath: apeShell,
        privateKeyPem: privatePem,
        publicKeySshLine: publicSshLine,
        authJson,
        claudeSettingsJson: includeClaudeHook ? CLAUDE_SETTINGS_JSON : null,
        hookScriptSource: includeClaudeHook ? BASH_VIA_APE_SHELL_HOOK_SOURCE : null,
      })
      writeFileSync(scriptPath, script, { mode: 0o700 })

      consola.start('Running privileged setup as root via `apes run --as root`…')
      consola.info('You will be asked to approve the as=root grant in your DDISA inbox.')
      execFileSync(apes, ['run', '--as', 'root', '--', 'bash', scriptPath], { stdio: 'inherit' })

      consola.success(`Agent ${name} spawned.`)
      console.log('')
      console.log('Run as the agent with:')
      console.log(`  apes run --as ${name} -- claude --session-name ${name} --dangerously-skip-permissions`)
    }
    finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  },
})
