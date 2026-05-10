// Helpers for `apes agents spawn`. The chat-bridge is a daemon
// that runs as the agent user, listens to chat.openape.ai, and forwards
// messages to a local LLM CLI (pi). It needs access to a local litellm
// proxy — set up out-of-band by the spawning user (today: hand-crafted
// at ~/litellm/.env).
//
// As of #236 the daemon is installed as a system-wide LaunchDaemon at
// /Library/LaunchDaemons/eco.hofmann.apes.bridge.<agent>.plist with the
// agent set as <UserName>. That makes it boot without anyone being logged
// in (matters for hidden service accounts in the [200,500) UID range
// which never get a GUI session).

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const PLIST_LABEL_PREFIX = 'eco.hofmann.apes.bridge'

export interface BridgeConfig {
  /** Where the bridge will POST messages — http://host:port/v1 */
  baseUrl: string
  /** Master key for the litellm proxy */
  apiKey: string
  /**
   * Model the bridge sends in every chat-completion request. Optional:
   * if undefined, the bridge falls back to its built-in default
   * (`claude-haiku-4-5`). Set this when the upstream proxy doesn't
   * route that model — e.g. a LiteLLM proxy fronting only ChatGPT
   * subscription needs `gpt-5.4` or the proxy 404s every request.
   */
  model?: string
}

/**
 * Read defaults from `~/litellm/.env` (the hand-crafted location patrick
 * uses today). Returns null if no file or no key found.
 */
export function readLitellmEnv(envPath: string = join(homedir(), 'litellm', '.env')): { apiKey?: string, baseUrl?: string, model?: string } | null {
  if (!existsSync(envPath)) return null
  try {
    const text = readFileSync(envPath, 'utf8')
    const out: { apiKey?: string, baseUrl?: string, model?: string } = {}
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq < 0) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      if (key === 'LITELLM_MASTER_KEY' || key === 'LITELLM_API_KEY') out.apiKey = value
      if (key === 'LITELLM_BASE_URL') out.baseUrl = value
      if (key === 'APE_CHAT_BRIDGE_MODEL') out.model = value
    }
    return out
  }
  catch {
    return null
  }
}

/** Resolve config from CLI flags + env defaults. CLI wins. */
export function resolveBridgeConfig(opts: {
  cliKey?: string
  cliBaseUrl?: string
  cliModel?: string
  envPath?: string
}): BridgeConfig {
  const env = readLitellmEnv(opts.envPath)
  const apiKey = opts.cliKey ?? env?.apiKey
  const baseUrl = opts.cliBaseUrl ?? env?.baseUrl ?? 'http://127.0.0.1:4000/v1'
  const model = opts.cliModel ?? env?.model
  if (!apiKey) {
    throw new Error(
      'No LITELLM_API_KEY resolved. Pass --bridge-key sk-… or write LITELLM_MASTER_KEY into ~/litellm/.env first.',
    )
  }
  return { baseUrl, apiKey, model }
}

/**
 * Capture the host's bin directories the bridge needs at runtime:
 * `node` (for the `#!/usr/bin/env node` shebang on the bridge binary),
 * `ape-agent` (the bridge itself), and `apes` (for the
 * `apes agents serve --rpc` subprocess the bridge spawns).
 *
 * On Homebrew macOS these all live in /opt/homebrew/bin. Resolved
 * dynamically so the same code works under nvm, volta, asdf, or
 * system Node. Throws if any required binary isn't on the host PATH —
 * that means the operator hasn't installed the OpenApe stack yet
 * (`npm i -g @openape/apes @openape/ape-agent` fixes it). The
 * thrown error is the right surface area: previously the spawn flow
 * silently `bun add -g`'d the missing pieces per agent, costing
 * 30-90s/spawn and ~100MB/agent.
 *
 * `ape-agent` is the canonical binary name (renamed from
 * `openape-chat-bridge` in @openape/ape-agent@2.0.0). The old name
 * is still shipped as an alias by the same package, so existing
 * pm2 ecosystem.config.js that reference `openape-chat-bridge`
 * keep working on hosts that have @openape/ape-agent installed.
 */
export function captureHostBinDirs(): string[] {
  const dirs: string[] = []
  const seen = new Set<string>()
  for (const bin of ['node', 'ape-agent', 'apes']) {
    let resolved: string
    try {
      resolved = execFileSync('/usr/bin/which', [bin], { encoding: 'utf8' }).trim()
    }
    catch {
      const installCmd = bin === 'ape-agent'
        ? 'npm i -g @openape/ape-agent'
        : bin === 'apes'
          ? 'npm i -g @openape/apes'
          : 'install Node.js (e.g. brew install node)'
      throw new Error(`'${bin}' not found on host PATH. ${installCmd} before spawning agents — the bridge runtime resolves these at spawn time and bakes the dir into the agent's launchd plist.`)
    }
    const dir = dirname(resolved)
    if (!seen.has(dir)) {
      seen.add(dir)
      dirs.push(dir)
    }
  }
  return dirs
}

export function bridgePlistLabel(agentName: string): string {
  return `${PLIST_LABEL_PREFIX}.${agentName}`
}

/** Path of the system LaunchDaemon plist. Root-owned, writable only by root. */
export function bridgePlistPath(agentName: string): string {
  return `/Library/LaunchDaemons/${bridgePlistLabel(agentName)}.plist`
}

export function buildBridgeEnvFile(cfg: BridgeConfig): string {
  const modelLine = cfg.model ? `APE_CHAT_BRIDGE_MODEL=${cfg.model}\n` : ''
  return `# Auto-generated by 'apes agents spawn'.
# Read by the chat-bridge daemon at boot to talk to the local LLM proxy.
LITELLM_BASE_URL=${cfg.baseUrl}
LITELLM_API_KEY=${cfg.apiKey}
${modelLine}`
}

/**
 * start.sh content. Slim — assumes the bridge stack (chat-bridge + apes
 * + pi) was already bun-installed during spawn. Each launchd boot only:
 *
 *   1. Drops the litellm pi extension if missing (idempotent).
 *   2. Sources the proxy env + execs the bridge.
 *
 * Boot time goes from ~75s (with installs) to ~3-5s.
 *
 * Token refresh: handled in-process by `@openape/cli-auth`, which
 * does its own Ed25519 challenge-response when the cached IdP token
 * expires (`auth.json.key_path` points at `~/.ssh/id_ed25519`). No
 * `apes login` shell-out needed at boot — the daemon stays connected
 * across the 1h expiry boundary instead of crash-restarting. See #259.
 *
 * To upgrade an agent's bridge after a new release:
 *   npm i -g @openape/ape-agent@latest
 *   apes run --as <name> -- pm2 reload openape-bridge-<name>
 */
export function buildBridgeStartScript(hostBinDirs: string[]): string {
  // PATH is the host's resolved bin dirs (from captureHostBinDirs)
  // followed by the standard system path. The PATH key in the launchd
  // plist already sets this for the exec'd process — start.sh repeats
  // it because some shells reset PATH on `set -a`.
  const pathLine = `export PATH="${hostBinDirs.join(':')}:/usr/bin:/bin"`
  return `#!/usr/bin/env bash
# Auto-generated by 'apes agents spawn'.
# Slim launcher — bridge stack lives on the host, no per-agent install.
set -euo pipefail

${pathLine}

# Token refresh is in-process via @openape/cli-auth's challenge-response
# path (auth.json.key_path -> ~/.ssh/id_ed25519). No "apes login" needed
# at boot — keeping start.sh slim avoids the rate-limit dance the old
# refresh hit when KeepAlive crash-restarted the daemon every 1h.

set -a
. "$HOME/Library/Application Support/openape/bridge/.env"
set +a
exec ape-agent
`
}

/**
 * System LaunchDaemon plist. Lives at /Library/LaunchDaemons/. macOS boots
 * it automatically and respawns on crash via KeepAlive. UserName ensures
 * launchd starts the process as the agent (not root), even though the
 * plist itself is root-owned.
 *
 * `OPENAPE_OWNER_EMAIL` is stamped into the daemon environment as a
 * defense-in-depth fallback for the chat-bridge identity check: the
 * canonical source is `owner_email` in `~/.config/apes/auth.json`
 * (written by spawn), but if a future `apes login` ever clobbers that
 * field the bridge can still resolve its owner from this env var.
 */
export function buildBridgePlist(agentName: string, homeDir: string, ownerEmail: string, hostBinDirs: string[]): string {
  const startScript = `${homeDir}/Library/Application Support/openape/bridge/start.sh`
  const stdoutLog = `${homeDir}/Library/Logs/ape-agent.log`
  const stderrLog = `${homeDir}/Library/Logs/ape-agent.err.log`
  // PATH = host's resolved bin dirs (where node, ape-agent,
  // and apes already live) + standard system path. No `~/.bun/bin`
  // entry — the per-agent bun install was retired in favour of host-
  // wide tooling. See captureHostBinDirs for resolution.
  const pathValue = `${hostBinDirs.join(':')}:/usr/bin:/bin`
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${bridgePlistLabel(agentName)}</string>
    <key>UserName</key>
    <string>${agentName}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${startScript}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${homeDir}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>${stdoutLog}</string>
    <key>StandardErrorPath</key>
    <string>${stderrLog}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${homeDir}</string>
        <key>PATH</key>
        <string>${pathValue}</string>
        <key>OPENAPE_OWNER_EMAIL</key>
        <string>${ownerEmail}</string>
    </dict>
</dict>
</plist>
`
}
