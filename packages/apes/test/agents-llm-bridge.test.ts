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
    expect(cfg).toEqual({ apiKey: 'sk-cli-only', baseUrl: 'http://only:2/v1' })
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
  })

  it('buildBridgeStartScript is slim — no npm installs at runtime, drops pi extension, execs bridge', () => {
    const sh = buildBridgeStartScript()
    expect(sh.startsWith('#!/usr/bin/env bash')).toBe(true)
    // Heavy installs MUST happen during spawn, not on every launchd boot —
    // the whole point of #246. start.sh stays under ~5s wall-clock.
    expect(sh).not.toContain('npm install')
    expect(sh).not.toContain('bun add')
    expect(sh).toContain('EXT_DIR="$HOME/.pi/agent/extensions"')
    expect(sh).toContain('"$EXT_DIR/litellm.ts"')
    expect(sh).toContain('. "$HOME/.pi/agent/.env"')
    expect(sh).toContain('exec openape-chat-bridge')
    // PATH includes the bun global bin dir where the installer landed
    // (bun symlinks live in ~/.bun/bin, NOT ~/.bun/install/global/bin).
    expect(sh).toContain('$HOME/.bun/bin')
  })

  it('buildBridgeStartScript refreshes IdP token before exec (1h expiry workaround)', () => {
    const sh = buildBridgeStartScript()
    // The script must read the agent's own email and idp out of auth.json
    // and call `apes login` BEFORE exec'ing the bridge — otherwise the
    // bridge picks up the (potentially expired) cached token and crashes.
    expect(sh).toContain('~/.config/apes/auth.json')
    expect(sh).toContain('apes login "$agent_email" --idp "$agent_idp"')
    const loginIdx = sh.indexOf('apes login')
    const execIdx = sh.indexOf('exec openape-chat-bridge')
    expect(loginIdx).toBeGreaterThan(0)
    expect(execIdx).toBeGreaterThan(loginIdx)
  })

  it('buildBridgePlist embeds agent name as label + UserName + paths + KeepAlive', () => {
    const plist = buildBridgePlist('agent-x', '/Users/agent-x')
    expect(plist).toContain('<string>eco.hofmann.apes.bridge.agent-x</string>')
    expect(plist).toContain('<key>UserName</key>')
    expect(plist).toContain('<string>agent-x</string>')
    expect(plist).toContain('<string>/Users/agent-x/Library/Application Support/openape/bridge/start.sh</string>')
    expect(plist).toContain('<string>/Users/agent-x/Library/Logs/openape-chat-bridge.log</string>')
    expect(plist).toContain('<key>KeepAlive</key>')
    expect(plist).toContain('<key>RunAtLoad</key>')
    expect(plist).toContain('<key>HOME</key>')
  })

  it('bridgePlistLabel + bridgePlistPath include agent name', () => {
    expect(bridgePlistLabel('agent-x')).toBe('eco.hofmann.apes.bridge.agent-x')
    expect(bridgePlistPath('agent-x')).toBe('/Library/LaunchDaemons/eco.hofmann.apes.bridge.agent-x.plist')
  })
})
