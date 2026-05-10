import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  bridgePlistLabel,
  bridgePlistPath,
  buildBridgeEnvFile,
  buildBridgePlist,
  buildBridgeStartScript,
  readLitellmEnv,
  resolveBridgeConfig,
} from '../src/lib/llm-bridge'

describe('llm-bridge — pure helpers', () => {
  it('readLitellmEnv parses LITELLM_MASTER_KEY + LITELLM_BASE_URL, ignores comments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lbenv-'))
    try {
      const path = join(dir, '.env')
      writeFileSync(path, [
        '# comment',
        '',
        'LITELLM_MASTER_KEY=sk-litellm-AAAA',
        'LITELLM_BASE_URL=http://example:9999/v1',
        'OTHER=ignored',
      ].join('\n'))
      const got = readLitellmEnv(path)
      expect(got).toEqual({ apiKey: 'sk-litellm-AAAA', baseUrl: 'http://example:9999/v1' })
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('readLitellmEnv returns null when file missing', () => {
    expect(readLitellmEnv('/nonexistent/path/.env')).toBeNull()
  })

  it('readLitellmEnv accepts LITELLM_API_KEY as alias for LITELLM_MASTER_KEY', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lbenv-alias-'))
    try {
      const path = join(dir, '.env')
      writeFileSync(path, 'LITELLM_API_KEY=sk-litellm-BBB\n')
      expect(readLitellmEnv(path)).toEqual({ apiKey: 'sk-litellm-BBB' })
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolveBridgeConfig: CLI flags win over .env defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lbenv-mix-'))
    try {
      const envPath = join(dir, '.env')
      writeFileSync(envPath, 'LITELLM_MASTER_KEY=sk-from-env\nLITELLM_BASE_URL=http://env:1/v1\n')
      const cfg = resolveBridgeConfig({ cliKey: 'sk-from-cli', envPath })
      expect(cfg.apiKey).toBe('sk-from-cli')
      expect(cfg.baseUrl).toBe('http://env:1/v1') // base URL not overridden
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolveBridgeConfig: pure CLI mode (no env file)', () => {
    const cfg = resolveBridgeConfig({
      cliKey: 'sk-cli-only',
      cliBaseUrl: 'http://only:2/v1',
      envPath: '/nonexistent',
    })
    expect(cfg).toEqual({ apiKey: 'sk-cli-only', baseUrl: 'http://only:2/v1', model: undefined })
  })

  it('resolveBridgeConfig: cliModel overrides env model', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lbenv-model-'))
    try {
      const envPath = join(dir, '.env')
      writeFileSync(envPath, 'LITELLM_MASTER_KEY=k\nAPE_CHAT_BRIDGE_MODEL=gpt-5.4\n')
      const cfg = resolveBridgeConfig({ cliModel: 'gpt-5.4-pro', envPath })
      expect(cfg.model).toBe('gpt-5.4-pro')
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolveBridgeConfig: pure env mode falls back to default base URL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lbenv-env-only-'))
    try {
      const envPath = join(dir, '.env')
      writeFileSync(envPath, 'LITELLM_MASTER_KEY=sk-env-only\n')
      const cfg = resolveBridgeConfig({ envPath })
      expect(cfg.apiKey).toBe('sk-env-only')
      expect(cfg.baseUrl).toBe('http://127.0.0.1:4000/v1')
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolveBridgeConfig throws when no key resolved', () => {
    expect(() => resolveBridgeConfig({ envPath: '/nonexistent' })).toThrow(/LITELLM_API_KEY/)
  })

  it('buildBridgeEnvFile shape', () => {
    const env = buildBridgeEnvFile({ apiKey: 'sk-x', baseUrl: 'http://h:1/v1' })
    expect(env).toContain('LITELLM_API_KEY=sk-x')
    expect(env).toContain('LITELLM_BASE_URL=http://h:1/v1')
    expect(env).not.toContain('APE_CHAT_BRIDGE_MODEL=')
  })

  it('buildBridgeEnvFile writes APE_CHAT_BRIDGE_MODEL when model is set', () => {
    const env = buildBridgeEnvFile({ apiKey: 'k', baseUrl: 'http://x/v1', model: 'gpt-5.4' })
    expect(env).toContain('APE_CHAT_BRIDGE_MODEL=gpt-5.4')
  })

  it('buildBridgeStartScript is slim — no npm installs at runtime, no pi extension write, execs bridge', () => {
    const sh = buildBridgeStartScript(['/opt/homebrew/bin', '/usr/local/bin'])
    expect(sh.startsWith('#!/usr/bin/env bash')).toBe(true)
    // Heavy installs MUST happen during spawn, not on every launchd boot —
    // the whole point of #246. start.sh stays under ~5s wall-clock.
    expect(sh).not.toContain('npm install')
    expect(sh).not.toContain('bun add')
    // M6 dropped the pi-extension write — the runtime is now ours
    // (M8 swaps chat-bridge to spawn `apes agents serve --rpc`).
    expect(sh).not.toContain('.pi/agent/extensions')
    expect(sh).not.toContain('PI_EXT_EOF')
    // Env file moved out of ~/.pi/agent and into the bridge dir.
    expect(sh).toContain('"$HOME/Library/Application Support/openape/bridge/.env"')
    expect(sh).toContain('exec ape-agent')
    // PATH includes the host-resolved bin dirs passed in.
    expect(sh).toContain('/opt/homebrew/bin')
  })

  it('buildBridgeStartScript no longer invokes `apes login` — refresh is in-process via cli-auth (#259)', () => {
    const sh = buildBridgeStartScript(['/opt/homebrew/bin'])
    // Token refresh moved into @openape/cli-auth's challenge-response
    // path. start.sh used to invoke `apes login` on every daemon boot
    // as a workaround for the 1h agent-token expiry; now cli-auth
    // handles it without shelling out, so the daemon stays connected
    // across expiry instead of crash-restarting.
    //
    // Match the actual command invocation (whitespace-bracketed) instead
    // of the bare substring — comments still mention the historical
    // command name.
    expect(sh).not.toMatch(/(^|[\s;|&])apes\s+login\b/m)
  })

  it('buildBridgePlist embeds agent name as label + UserName + paths + KeepAlive', () => {
    const plist = buildBridgePlist('agent-x', '/Users/agent-x', 'patrick@hofmann.eco', ['/opt/homebrew/bin'])
    expect(plist).toContain('<string>eco.hofmann.apes.bridge.agent-x</string>')
    expect(plist).toContain('<key>UserName</key>')
    expect(plist).toContain('<string>agent-x</string>')
    expect(plist).toContain('<string>/Users/agent-x/Library/Application Support/openape/bridge/start.sh</string>')
    expect(plist).toContain('<string>/Users/agent-x/Library/Logs/ape-agent.log</string>')
    expect(plist).toContain('<key>KeepAlive</key>')
    expect(plist).toContain('<key>RunAtLoad</key>')
    expect(plist).toContain('<key>HOME</key>')
  })

  it('buildBridgePlist stamps OPENAPE_OWNER_EMAIL in EnvironmentVariables', () => {
    const plist = buildBridgePlist('agent-x', '/Users/agent-x', 'patrick@hofmann.eco', ['/opt/homebrew/bin'])
    // Defense-in-depth: bridge falls back to this env var when auth.json
    // lacks owner_email (e.g. an old `apes login` clobbered it). Without
    // this the daemon would crash-loop on "missing 'owner_email'".
    expect(plist).toContain('<key>OPENAPE_OWNER_EMAIL</key>')
    expect(plist).toContain('<string>patrick@hofmann.eco</string>')
  })

  it('bridgePlistLabel + bridgePlistPath include agent name', () => {
    expect(bridgePlistLabel('agent-x')).toBe('eco.hofmann.apes.bridge.agent-x')
    expect(bridgePlistPath('agent-x')).toBe('/Library/LaunchDaemons/eco.hofmann.apes.bridge.agent-x.plist')
  })
})
