import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BRIDGE_PLIST_LABEL,
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

  it('buildBridgeStartScript installs idempotently + sources env + execs bridge', () => {
    const sh = buildBridgeStartScript()
    expect(sh.startsWith('#!/usr/bin/env bash')).toBe(true)
    expect(sh).toContain('bun add -g @openape/chat-bridge')
    expect(sh).toContain('. "$HOME/.pi/agent/.env"')
    expect(sh).toContain('exec openape-chat-bridge')
  })

  it('buildBridgePlist embeds homedir paths + KeepAlive + correct label', () => {
    const plist = buildBridgePlist('/Users/agent-x')
    expect(plist).toContain(`<string>${BRIDGE_PLIST_LABEL}</string>`)
    expect(plist).toContain('<string>/Users/agent-x/Library/Application Support/openape/bridge/start.sh</string>')
    expect(plist).toContain('<string>/Users/agent-x/Library/Logs/openape-chat-bridge.log</string>')
    expect(plist).toContain('<key>KeepAlive</key>')
    expect(plist).toContain('<key>RunAtLoad</key>')
    expect(plist).toContain('<key>HOME</key>')
  })
})
