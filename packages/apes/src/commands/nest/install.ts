// `apes nest install` — bootstrap the local nest-daemon.
//
// Stage 1 MVP: the daemon runs as the human user (a future stage will
// migrate to a dedicated `_openape_nest` service-account). The
// platform-specific bits (plist on macOS / systemd unit on Linux) live
// behind `getHostPlatform().installNestSupervisor`. The command here
// keeps the platform-neutral setup: writing the shapes adapter,
// seeding the bridge-model env, resolving binary paths, and the
// post-install human-facing instructions.
//
// Idempotent — re-running on an already-installed nest just re-bootstraps
// (effectively a restart).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { defineCommand } from 'citty'
import consola from 'consola'
import { getHostPlatform } from '../../lib/host-platform'
import { APES_AGENTS_ADAPTER_TOML } from './apes-agents-adapter'
import { NEST_DATA_DIR } from './enroll'

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
 * Write `APE_CHAT_BRIDGE_MODEL=<value>` to `~/litellm/.env` AND to
 * the nest's own `litellm/.env` (under `NEST_DATA_DIR`). The same
 * file resolveBridgeConfig (in lib/llm-bridge.ts) reads at
 * `apes [nest|agents] spawn` time — but it resolves the path via
 * `homedir()`, so:
 *
 *   - Patrick-driven spawn (`apes agents spawn …` from a shell)
 *     reads `~/litellm/.env`.
 *   - Nest-driven spawn (TroopWs handler running as the daemon)
 *     reads `~/.openape/nest/litellm/.env` because the launchd plist
 *     pins `HOME=NEST_DATA_DIR` for the daemon process.
 *
 * Writing to both keeps the model default consistent between the
 * two entry points — without this, freshly-installed nests had no
 * `APE_CHAT_BRIDGE_MODEL` line and the bridge crash-looped on every
 * spawn-from-troop-UI with `fatal: APE_CHAT_BRIDGE_MODEL is not set`.
 *
 * Idempotent: replaces an existing line in place, appends otherwise.
 */
function writeBridgeModelDefault(model: string): void {
  for (const envDir of [join(homedir(), 'litellm'), join(NEST_DATA_DIR, 'litellm')]) {
    const envFile = join(envDir, '.env')
    mkdirSync(envDir, { recursive: true })
    let lines: string[] = []
    if (existsSync(envFile)) {
      lines = readFileSync(envFile, 'utf8').split('\n').filter(l => !l.startsWith('APE_CHAT_BRIDGE_MODEL='))
    }
    lines.push(`APE_CHAT_BRIDGE_MODEL=${model}`)
    while (lines.length > 0 && lines.at(-1)!.trim() === '') lines.pop()
    writeFileSync(envFile, `${lines.join('\n')}\n`, { mode: 0o600 })
  }
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
      description: 'Default model for ape-agent spawns. Persisted as APE_CHAT_BRIDGE_MODEL in ~/litellm/.env so every `apes [nest|agents] spawn` picks it up automatically. Common values: `gpt-5.4` (ChatGPT-only LiteLLM proxy), `claude-haiku-4-5` (Anthropic-only). Re-run install with a new value to overwrite.',
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

    consola.info(`Installing nest supervisor`)
    consola.info(`  nest binary: ${nestBin}`)
    consola.info(`  apes binary: ${apesBin}`)
    consola.info(`  HTTP port:   ${port}`)

    if (typeof args['bridge-model'] === 'string' && args['bridge-model']) {
      writeBridgeModelDefault(args['bridge-model'])
      consola.success(`Default bridge model set to ${args['bridge-model']} (in ~/litellm/.env)`)
    }

    // Adapter first — capability-grants need it.
    installAdapter()

    // nest-data-dir is HOME for the daemon — apes-cli subprocesses
    // it spawns (apes run --as root --) read auth.json from the nest's
    // own enrolled identity, not the human's, so YOLO-policy on the
    // nest-agent gates them.
    mkdirSync(NEST_DATA_DIR, { recursive: true })

    await getHostPlatform().installNestSupervisor({
      nestBin,
      apesBin,
      userHome: homeDir,
      nestHome: NEST_DATA_DIR,
      port,
    })
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
