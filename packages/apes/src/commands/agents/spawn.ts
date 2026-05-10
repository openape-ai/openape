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
import { buildSyncPlist } from '../../lib/troop-bootstrap'
import { generateKeyPairInMemory } from '../../lib/keygen'
import {
  bridgePlistLabel,
  bridgePlistPath,
  buildBridgeEnvFile,
  buildBridgePlist,
  buildBridgeStartScript,
  captureHostBinDirs,
  resolveBridgeConfig,
} from '../../lib/llm-bridge'
import { isDarwin, isShellRegistered, readMacOSUser, whichBinary } from '../../lib/macos-user'
import { upsertNestAgent } from '../../lib/nest-registry'

function readMacOSUidOrNull(name: string): number | null {
  try {
    const u = readMacOSUser(name)
    return u?.uid ?? null
  }
  catch { return null }
}

export const spawnAgentCommand = defineCommand({
  meta: {
    name: 'spawn',
    description: 'Provision a local macOS agent end-to-end (OS user, keypair, IdP agent, Claude hook)',
  },
  args: {
    name: {
      type: 'positional',
      description: 'Agent name — also the macOS short username (lowercase, [a-z0-9-], must start with a letter)',
      required: true,
    },
    shell: {
      type: 'string',
      description: 'Login shell for the macOS user. Default: /bin/zsh. Pass $(which ape-shell) to opt into the grant-mediated REPL as login shell.',
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
    'bridge': {
      type: 'boolean',
      description:
        'Install the openape-chat-bridge daemon for this agent: drops a launchd plist that runs `@openape/chat-bridge` so the agent answers chat.openape.ai messages. Reads LITELLM_API_KEY/BASE_URL defaults from ~/litellm/.env; override via --bridge-key / --bridge-base-url.',
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

    // Default to plain /bin/zsh (macOS modern default) — ape-shell as login
    // shell is opt-in via --shell. Rationale: ape-shell intercepts every
    // command through the grant flow which is the right model for unattended
    // agents but trips on interactive niceties (terminal control sequences
    // sent by tools like Warp, exit semantics, etc.). The Claude
    // bash-rewrite hook still routes Claude-issued commands through
    // ape-shell — that's where grant-mediation actually matters.
    const loginShell = (args.shell ?? '/bin/zsh').toString()
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
    if (!isShellRegistered(loginShell)) {
      throw new CliError(
        `${loginShell} is not registered in /etc/shells. macOS refuses to set it as a login shell. Run:\n`
        + `  echo ${loginShell} | sudo tee -a /etc/shells\n`
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

      const bridge = args.bridge
        ? (() => {
            const cfg = resolveBridgeConfig({
              cliKey: typeof args['bridge-key'] === 'string' ? args['bridge-key'] : undefined,
              cliBaseUrl: typeof args['bridge-base-url'] === 'string' ? args['bridge-base-url'] : undefined,
              cliModel: typeof args['bridge-model'] === 'string' ? args['bridge-model'] : undefined,
            })
            // Capture the host's bin dirs ONCE per spawn — same dirs
            // are baked into both the plist's PATH and start.sh.
            // Throws if node / openape-chat-bridge / apes aren't on
            // the host PATH.
            const hostBinDirs = captureHostBinDirs()
            return {
              plistLabel: bridgePlistLabel(name),
              plistPath: bridgePlistPath(name),
              plistContent: buildBridgePlist(name, homeDir, auth.email, hostBinDirs),
              startScript: buildBridgeStartScript(hostBinDirs),
              envFile: buildBridgeEnvFile(cfg),
            }
          })()
        : null

      // Troop sync launchd — installed for every agent (no opt-out
      // for v1). The plist runs `apes agents sync` every 5min and
      // RunAtLoad fires it once eagerly so the agent registers at
      // troop.openape.ai within seconds of spawn finishing.
      const troopPlistLabel = `openape.troop.sync.${name}`
      const troopPlistPath = `/Library/LaunchDaemons/${troopPlistLabel}.plist`
      // Reuse the bridge's host-bin-dir capture if a bridge was set
      // up; otherwise capture once for the troop sync alone. The
      // sync daemon needs `node` (apes-cli's shebang) and `apes`
      // (the actual binary it runs) on PATH.
      const troopBinDirs = bridge ? captureHostBinDirs() : captureHostBinDirs()
      const troop = {
        plistLabel: troopPlistLabel,
        plistPath: troopPlistPath,
        plistContent: buildSyncPlist({ agentName: name, apesBin: apes, homeDir, userName: name, hostBinDirs: troopBinDirs }),
      }

      const script = buildSpawnSetupScript({
        name,
        homeDir,
        shellPath: loginShell,
        privateKeyPem: privatePem,
        publicKeySshLine: publicSshLine,
        authJson,
        claudeSettingsJson: includeClaudeHook ? CLAUDE_SETTINGS_JSON : null,
        hookScriptSource: includeClaudeHook ? BASH_VIA_APE_SHELL_HOOK_SOURCE : null,
        claudeOauthToken,
        bridge,
        troop,
      })
      writeFileSync(scriptPath, script, { mode: 0o700 })

      consola.start('Running privileged setup as root via `apes run --as root --wait`…')
      consola.info('You will be asked to approve the as=root grant in your DDISA inbox; this command blocks until you do.')
      // --wait is critical: without it `apes run --as root` returns exit 75
      // (pending) immediately, which we'd interpret as failure and which
      // would leave a dangling grant referencing a scratch dir we'd cleaned
      // up in the finally below. With --wait, exit reflects the actual
      // execution result, so cleanup is safe.
      execFileSync(apes, ['run', '--as', 'root', '--wait', '--', 'bash', scriptPath], { stdio: 'inherit' })

      // Phase F: register in the Nest's registry directly (replaces
      // the old intent-channel handler in the Nest). The Nest
      // watches agents.json and reconciles its pm2-supervisor when
      // it sees a new entry — bridge starts within a second.
      try {
        const uid = readMacOSUidOrNull(name)
        upsertNestAgent({
          name,
          uid: uid ?? -1,
          home: homeDir,
          email: registration.email,
          registeredAt: Math.floor(Date.now() / 1000),
          bridge: args.bridge
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
        // glitched — the agent exists in macOS, the human can
        // manually register later. Log loudly.
        consola.warn(`Could not write to nest registry: ${err instanceof Error ? err.message : String(err)}`)
      }

      consola.success(`Agent ${name} spawned.`)
      consola.info(`🔗 Troop: https://troop.openape.ai/agents/${name}`)

      if (args.bridge) {
        consola.info(`On first boot, the bridge will send you a contact request from ${registration.email}.`)
        consola.info('Open chat.openape.ai and accept it to start chatting with the agent.')
      }

      console.log('')
      console.log('Run as the agent with:')
      console.log(`  apes run --as ${name} -- claude --session-name ${name} --dangerously-skip-permissions`)
    }
    finally {
      rmSync(scratch, { recursive: true, force: true })
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
