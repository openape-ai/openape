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
import { whichBinary } from '../../lib/which'
import { getHostPlatform } from '../../lib/host-platform'
import { upsertNestAgent } from '../../lib/nest-registry'

function readUidOrNull(name: string): number | null {
  try {
    const u = getHostPlatform().readAgentUser(name)
    return u?.uid ?? null
  }
  catch { return null }
}

export const spawnAgentCommand = defineCommand({
  meta: {
    name: 'spawn',
    description: 'Provision a local Linux agent end-to-end (OS user, keypair, IdP agent, Claude hook)',
  },
  args: {
    name: {
      type: 'positional',
      description: 'Agent name — also the Linux username (lowercase, [a-z0-9-], must start with a letter)',
      required: true,
    },
    shell: {
      type: 'string',
      description: 'Login shell for the Linux user. Default: /bin/bash. Pass $(which ape-shell) to opt into the grant-mediated REPL as login shell.',
    },
    'no-claude-hook': {
      type: 'boolean',
      description: 'Skip writing ~/.claude/settings.json + the Bash-rewrite hook',
    },
    'claude-token': {
      type: 'string',
      description: 'Claude Code OAuth token (sk-ant-oat01-…) from `claude setup-token`. Visible to ps — prefer --claude-token-stdin in scripts.',
    },
    'claude-token-stdin': {
      type: 'boolean',
      description: 'Read the Claude Code OAuth token from stdin (paranoid form of --claude-token).',
    },
    'no-bridge': {
      type: 'boolean',
      description:
        'Skip the ape-agent runtime install. Default behaviour installs the runtime so the agent answers chat.openape.ai messages (reads LITELLM_API_KEY/BASE_URL from ~/litellm/.env; override via --bridge-key / --bridge-base-url). Use --no-bridge for headless / CI / IdP-only account provisioning where the agent will not run a chat loop.',
    },
    'bridge-key': {
      type: 'string',
      description: 'Override LITELLM_API_KEY for the bridge (default: read from ~/litellm/.env).',
    },
    'bridge-base-url': {
      type: 'string',
      description: 'Override LITELLM_BASE_URL for the bridge (default: read from ~/litellm/.env or http://127.0.0.1:4000/v1).',
    },
    'bridge-model': {
      type: 'string',
      description: 'Model the bridge sends in chat-completion requests (default: claude-haiku-4-5). Override when fronting a proxy that doesn\'t route the default — e.g. ChatGPT-only proxy needs `gpt-5.4`.',
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

    const auth = loadAuth()
    if (!auth) {
      throw new CliError('Not authenticated. Run `apes login` first.')
    }
    const idp = getIdpUrl()
    if (!idp) {
      throw new CliError('No IdP URL configured. Run `apes login` first.')
    }

    // Default to plain /bin/bash — ape-shell as login shell is opt-in via
    // --shell. Rationale: ape-shell intercepts every command through the
    // grant flow which is the right model for unattended agents but trips
    // on interactive niceties (terminal control sequences, exit semantics,
    // etc.). The Claude bash-rewrite hook still routes Claude-issued
    // commands through ape-shell — that's where grant-mediation matters.
    const loginShell = (args.shell ?? '/bin/bash').toString()
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

    // On Linux the agent name IS the OS username (no prefix) — the
    // container's OpenApe namespace is the namespace, and Linux caps
    // usernames at 32 chars so a prefix would reject longer names.
    const platform = getHostPlatform()
    const osUsername = platform.agentUsername(name)
    const existing = platform.readAgentUser(osUsername)
    if (existing) {
      throw new CliError(`OS user "${existing.name}" already exists (uid=${existing.uid ?? '?'}). Refusing to overwrite.`)
    }

    // Hidden service-account agents live under /var/openape/homes/<name>,
    // keeping them out of /home for real human accounts.
    const homeDir = `/var/openape/homes/${osUsername}`

    try {
      consola.start(`Generating keypair for ${name}…`)
      const { privatePem, publicSshLine, x25519PrivateKey, x25519PublicKey } = generateKeyPairInMemory()

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
        keyPath: `${homeDir}/.ssh/id_ed25519`,
        // The IdP resolves the owner transitively (when the caller
        // is itself an agent — e.g. a Nest spawning a child — the
        // human at the top of the chain becomes owner). Use the
        // server-resolved owner, not the local caller's auth.email,
        // otherwise the agent's auth.json will carry the Nest's
        // email and troop will reject sync calls because the
        // encoded owner-domain in the agent email doesn't match
        // the auth.json's owner_email domain.
        ownerEmail: registration.owner,
      })

      const includeClaudeHook = !args['no-claude-hook']
      const claudeOauthToken = await resolveClaudeToken({
        flag: typeof args['claude-token'] === 'string' ? args['claude-token'] : undefined,
        fromStdin: !!args['claude-token-stdin'],
      })

      // Bridge install is the default — every agent needs the runtime
      // to answer chat or fire cron tasks. `--no-bridge` is the explicit
      // escape for headless / CI / account-only provisioning. The runtime
      // install itself is supervised by the Nest (reconciled off the
      // registry entry below), not baked into the setup script.
      const withBridge = !args['no-bridge']

      const script = buildSpawnSetupScript({
        name,
        homeDir,
        shellPath: loginShell,
        privateKeyPem: privatePem,
        publicKeySshLine: publicSshLine,
        x25519PrivateKey,
        x25519PublicKey,
        authJson,
        claudeSettingsJson: includeClaudeHook ? CLAUDE_SETTINGS_JSON : null,
        hookScriptSource: includeClaudeHook ? BASH_VIA_APE_SHELL_HOOK_SOURCE : null,
        claudeOauthToken,
      })
      // runPrivilegedBash short-circuits to a direct bash exec when we're
      // already root (nest → `apes run --as root -- apes agents spawn`
      // already obtained the grant); otherwise it routes through
      // `apes run --as root --wait` for the DDISA grant cycle.
      consola.start('Running privileged setup…')
      if (process.getuid?.() !== 0) {
        consola.info('You will be asked to approve the as=root grant in your DDISA inbox; this command blocks until you do.')
      }
      await platform.runPrivilegedBash(script)

      // Phase F: register in the Nest's registry directly (replaces
      // the old intent-channel handler in the Nest). The Nest
      // watches agents.json and reconciles its pm2-supervisor when
      // it sees a new entry — bridge starts within a second.
      try {
        const uid = readUidOrNull(osUsername) ?? -1
        upsertNestAgent({
          name,
          uid,
          home: homeDir,
          email: registration.email,
          registeredAt: Math.floor(Date.now() / 1000),
          bridge: withBridge
            ? {
                baseUrl: typeof args['bridge-base-url'] === 'string' ? args['bridge-base-url'] : undefined,
                apiKey: typeof args['bridge-key'] === 'string' ? args['bridge-key'] : undefined,
                model: typeof args['bridge-model'] === 'string' ? args['bridge-model'] : undefined,
              }
            : undefined,
        })
      }
      catch (err) {
        // Don't fail the spawn just because the registry write
        // glitched — the agent's OS user exists, the human can
        // manually register later. Log loudly.
        consola.warn(`Could not write to nest registry: ${err instanceof Error ? err.message : String(err)}`)
      }

      consola.success(`Agent ${name} spawned.`)
      consola.info(`🔗 Troop: https://troop.openape.ai/agents/${name}`)

      if (withBridge) {
        consola.info(`On first boot, the bridge will send you a contact request from ${registration.email}.`)
        consola.info('Open chat.openape.ai and accept it to start chatting with the agent.')
      }

      console.log('')
      console.log('Run as the agent with:')
      console.log(`  apes run --as ${name} -- claude --session-name ${name} --dangerously-skip-permissions`)
    }
    finally {
      // runPrivilegedBash owns the tmp-script lifecycle; nothing to clean here.
    }
  },
})

/**
 * Resolve the Claude Code OAuth token from --claude-token, --claude-token-stdin,
 * or neither (returns null = agent will need interactive auth on first claude
 * run). --flag and --stdin together is rejected as ambiguous.
 *
 * Validation: Claude tokens start with `sk-ant-oat01-`. We reject anything
 * else with a clear hint instead of silently writing a useless string.
 */
async function resolveClaudeToken(opts: { flag?: string, fromStdin: boolean }): Promise<string | null> {
  if (opts.flag && opts.fromStdin) {
    throw new CliError('Pass --claude-token OR --claude-token-stdin, not both.')
  }
  let raw: string | null = null
  if (typeof opts.flag === 'string') {
    raw = opts.flag.trim()
  }
  else if (opts.fromStdin) {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    }
    raw = Buffer.concat(chunks).toString('utf-8').trim()
  }
  if (!raw) return null
  if (!raw.startsWith('sk-ant-oat01-')) {
    throw new CliError(
      `Claude token doesn't look right (expected sk-ant-oat01-…). Run \`claude setup-token\``
      + ` and paste the resulting token.`,
    )
  }
  return raw
}
