// `apes nest install` — bootstrap the local nest-daemon.
//
// Stage 1 MVP: the daemon runs as the human user (a future stage will
// migrate to a dedicated `_openape_nest` service-account). Setup is
// three things:
//
//   1. Write ~/Library/LaunchAgents/ai.openape.nest.plist (user domain
//      — autostarts at login, KeepAlive=true)
//   2. `launchctl bootstrap` the plist into the user-launchd domain
//   3. Print instructions for the always-grant the user needs to
//      approve once at id.openape.ai/grant-approval
//
// Idempotent — re-running on an already-installed nest just re-bootstraps
// (effectively a restart).

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { defineCommand } from 'citty'
import consola from 'consola'
import { APES_AGENTS_ADAPTER_TOML } from './apes-agents-adapter'
import { NEST_DATA_DIR } from './enroll'

const PLIST_LABEL = 'ai.openape.nest'

function plistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`)
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

interface PlistArgs {
  nestBin: string
  apesBin: string
  /** macOS user home — used for log file path + PATH (where bun lives). */
  userHome: string
  /**
   * Nest data dir — `HOME` for the daemon process so apes-cli reads
   * the nest's own auth.json (not the human's) when invoking
   * subprocesses like `apes run --as root -- apes agents spawn`.
   */
  nestHome: string
  port: number
}

function buildPlist(args: PlistArgs): string {
  const logsDir = join(args.userHome, 'Library', 'Logs')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escape(PLIST_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escape(args.nestBin)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escape(args.nestHome)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${escape(args.nestHome)}</string>
    <key>PATH</key><string>${escape(args.userHome)}/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>OPENAPE_NEST_PORT</key><string>${args.port}</string>
    <key>OPENAPE_APES_BIN</key><string>${escape(args.apesBin)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${escape(logsDir)}/openape-nest.log</string>
  <key>StandardErrorPath</key>
  <string>${escape(logsDir)}/openape-nest.log</string>
</dict>
</plist>
`
}

/**
 * Bundled `apes-agents` shapes adapter — written into
 * `~/.openape/shapes/adapters/` so a capability-grant with selector
 * `name=*` can cover any agent name (selectorValueMatches glob).
 * Without this adapter, every spawn/destroy hits exact-arg matching
 * and the always-grant doesn't reuse.
 */
function installAdapter(): boolean {
  const target = join(homedir(), '.openape', 'shapes', 'adapters', 'apes-agents.toml')
  mkdirSync(dirname(target), { recursive: true })
  let existing = ''
  try { existing = readFileSync(target, 'utf8') }
  catch { /* not yet */ }
  if (existing === APES_AGENTS_ADAPTER_TOML) return false
  writeFileSync(target, APES_AGENTS_ADAPTER_TOML, { mode: 0o644 })
  consola.success(`Wrote shapes adapter ${target}`)
  return true
}

/**
 * Write `APE_CHAT_BRIDGE_MODEL=<value>` to `~/litellm/.env`. The same
 * file resolveBridgeConfig (in lib/llm-bridge.ts) reads at
 * `apes [nest|agents] spawn --bridge` time. Idempotent: replaces the
 * line in place if it already exists, appends otherwise. Creates the
 * file (and ~/litellm/) on first call.
 *
 * Why ~/litellm/.env and not the central /etc/openape/litellm.env:
 * fresh installs (no privilege-isolation migration yet) only have the
 * user-home file. The central file is the optional post-migration
 * upgrade — see migrate-to-service-user.sh which symlinks both
 * locations to /etc/openape/litellm.env so writing to ~/litellm/.env
 * keeps working for both layouts.
 */
function writeBridgeModelDefault(model: string): void {
  const envDir = join(homedir(), 'litellm')
  const envFile = join(envDir, '.env')
  mkdirSync(envDir, { recursive: true })
  let lines: string[] = []
  if (existsSync(envFile)) {
    lines = readFileSync(envFile, 'utf8').split('\n').filter(l => !l.startsWith('APE_CHAT_BRIDGE_MODEL='))
  }
  lines.push(`APE_CHAT_BRIDGE_MODEL=${model}`)
  // Trim trailing blanks then ensure file ends with one newline
  while (lines.length > 0 && lines.at(-1)!.trim() === '') lines.pop()
  writeFileSync(envFile, `${lines.join('\n')}\n`, { mode: 0o600 })
}

function findBinary(name: string): string {
  for (const dir of [
    join(homedir(), '.bun', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
  ]) {
    const p = join(dir, name)
    if (existsSync(p)) return p
  }
  throw new Error(`could not locate ${name} on PATH; install it first`)
}

export const installNestCommand = defineCommand({
  meta: {
    name: 'install',
    description: 'Install + start the local nest-daemon (idempotent — re-running just restarts)',
  },
  args: {
    port: {
      type: 'string',
      description: 'Port for the nest HTTP API (default: 9091)',
    },
    'bridge-model': {
      type: 'string',
      description: 'Default model for chat-bridge spawns. Persisted as APE_CHAT_BRIDGE_MODEL in ~/litellm/.env so every `apes [nest|agents] spawn --bridge` picks it up automatically. Common values: `gpt-5.4` (ChatGPT-only LiteLLM proxy), `claude-haiku-4-5` (Anthropic-only). Re-run install with a new value to overwrite.',
    },
  },
  async run({ args }) {
    const homeDir = homedir()
    const port = Number(args.port ?? 9091)
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error(`invalid port ${port}`)
    }
    const nestBin = findBinary('openape-nest')
    const apesBin = findBinary('apes')

    consola.info(`Installing nest at ${plistPath()}`)
    consola.info(`  nest binary: ${nestBin}`)
    consola.info(`  apes binary: ${apesBin}`)
    consola.info(`  HTTP port:   ${port}`)

    if (typeof args['bridge-model'] === 'string' && args['bridge-model']) {
      writeBridgeModelDefault(args['bridge-model'])
      consola.success(`Default bridge model set to ${args['bridge-model']} (in ~/litellm/.env)`)
    }

    // Adapter first — capability-grants need it.
    installAdapter()

    mkdirSync(join(homeDir, 'Library', 'LaunchAgents'), { recursive: true })

    // nest-data-dir is HOME for the daemon — apes-cli subprocesses
    // it spawns (apes run --as root --) read auth.json from the nest's
    // own enrolled identity, not the human's, so YOLO-policy on the
    // nest-agent gates them.
    mkdirSync(NEST_DATA_DIR, { recursive: true })
    const desired = buildPlist({ nestBin, apesBin, userHome: homeDir, nestHome: NEST_DATA_DIR, port })
    let existing = ''
    try { existing = readFileSync(plistPath(), 'utf8') }
    catch { /* not yet installed */ }

    if (existing !== desired) {
      writeFileSync(plistPath(), desired, { mode: 0o644 })
      consola.success('Wrote launchd plist')
    }
    else {
      consola.info('plist already up to date')
    }

    // Idempotent (re)load. bootout silently no-ops if the job isn't
    // loaded yet; bootstrap fails loud if the plist has a syntax error,
    // which is what we want.
    const uid = userInfo().uid
    try {
      execFileSync('/bin/launchctl', ['bootout', `gui/${uid}/${PLIST_LABEL}`], { stdio: 'ignore' })
    }
    catch { /* not loaded */ }
    execFileSync('/bin/launchctl', ['bootstrap', `gui/${uid}`, plistPath()], { stdio: 'inherit' })
    consola.success(`Nest daemon bootstrapped — http://127.0.0.1:${port}`)

    consola.info('')
    consola.info('Next steps for zero-prompt spawn — both one-time:')
    consola.info('')
    consola.info('  1. apes nest enroll       # register nest as DDISA agent (creates own auth.json)')
    consola.info('  2. apes nest authorize    # set YOLO-policy on the nest agent')
    consola.info('')
    consola.info('After that, every `POST http://127.0.0.1:9091/agents` runs without DDISA prompts.')
  },
})
