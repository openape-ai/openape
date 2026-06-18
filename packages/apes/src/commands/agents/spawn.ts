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
import { getHostPlatform } from '../../lib/host-platform'
import { isRuntimeType, upsertNestAgent } from '../../lib/nest-registry'

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
    'bridge-reasoning-effort': {
      type: 'string',
      description: 'Reasoning/thinking depth for gpt-5.x (minimal|low|medium|high). Tier compute by task difficulty on the same model — quick-win=low, research=high.',
    },
    'kind': {
      type: 'string',
      description: 'Agent kind: "user" (default, connects to troop-chat) or "service" (polls an SP backend\'s task queue and runs each task through the LLM). With "service", --serves is required.',
    },
    'serves': {
      type: 'string',
      description: 'For --kind service: base URL of the SP backend this agent serves (e.g. https://zaz.delta-mind.at or http://127.0.0.1:3013). The agent pulls GetNextTask / posts ResolveTask there.',
    },
    'poll-interval': {
      type: 'string',
      description: 'For --kind service: idle poll interval in ms (default 2000).',
    },
    'type': {
      type: 'string',
      description: 'Runtime type: "bridge" (default, our @openape/ape-agent loop, pm2-supervised) or "openclaw" (foreign one-shot runtime the nest exec\'s per message). Orthogonal to --kind.',
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

    if (args.kind != null && args.kind !== 'user' && args.kind !== 'service')
      throw new CliError(`Invalid --kind "${String(args.kind)}". Must be "user" or "service".`)
    const isService = args.kind === 'service'
    const servesUrl = typeof args.serves === 'string' ? args.serves.replace(/\/$/, '') : undefined
    if (isService && !servesUrl)
      throw new CliError('--kind service requires --serves <SP base URL> (e.g. https://zaz.delta-mind.at).')
    const pollMs = typeof args['poll-interval'] === 'string' ? Number.parseInt(args['poll-interval'], 10) : undefined
    const runtimeType = typeof args.type === 'string' ? args.type : undefined
    if (runtimeType != null && !isRuntimeType(runtimeType))
      throw new CliError(`Invalid --type "${runtimeType}". Must be "bridge" or "openclaw".`)

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

    // On Linux the agent name IS the OS username (no prefix) — the
    // container's OpenApe namespace is the namespace, and Linux caps
    // usernames at 32 chars so a prefix would reject longer names.
    const platform = getHostPlatform()
    const osUsername = platform.agentUsername(name)
    const existing = platform.readAgentUser(osUsername)
    if (existing) {
      throw new CliError(`OS user "${existing.name}" already exists (uid=${existing.uid ?? '?'}). Refusing to overwrite.`)
    }

    // Agent homes live under /var/lib/openape/homes/<name> — the
    // persisted `openape-homes` volume the nest container mounts (and the
    // dir docker-entrypoint.sh reconciles on restart), kept out of /home
    // where real human accounts live.
    const homeDir = `/var/lib/openape/homes/${osUsername}`

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
        kind: isService ? 'service' : undefined,
        runtimeType,
        service: isService && servesUrl
          ? { spBaseUrl: servesUrl, pollIntervalMs: pollMs != null && Number.isFinite(pollMs) && pollMs > 0 ? pollMs : undefined }
          : undefined,
        // Service agents also carry bridge config — it's the LLM endpoint the
        // worker forwards to (baseUrl/key/model from --bridge-*).
        bridge: withBridge || isService
          ? {
              baseUrl: typeof args['bridge-base-url'] === 'string' ? args['bridge-base-url'] : undefined,
              apiKey: typeof args['bridge-key'] === 'string' ? args['bridge-key'] : undefined,
              model: typeof args['bridge-model'] === 'string' ? args['bridge-model'] : undefined,
              reasoningEffort: typeof args['bridge-reasoning-effort'] === 'string' ? args['bridge-reasoning-effort'] : undefined,
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
  },
})
