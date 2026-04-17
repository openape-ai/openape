import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testHome = join(tmpdir(), `apes-config-generic-${process.pid}-${Date.now()}`)
mkdirSync(testHome, { recursive: true })

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  return { ...original, homedir: () => testHome }
})

const configDir = join(testHome, '.config', 'apes')
const configFile = join(configDir, 'config.toml')

function writeConfig(toml: string) {
  mkdirSync(configDir, { recursive: true })
  writeFileSync(configFile, toml)
}

function clearConfig() {
  rmSync(configDir, { recursive: true, force: true })
}

describe('[generic] config section', () => {
  beforeEach(() => {
    clearConfig()
    vi.resetModules()
  })

  afterEach(() => {
    clearConfig()
  })

  afterAll(() => {
    rmSync(testHome, { recursive: true, force: true })
  })

  it('returns enabled=true by default (no config file)', async () => {
    const { isGenericFallbackEnabled } = await import('../src/config.js')
    expect(isGenericFallbackEnabled()).toBe(true)
  })

  it('returns enabled=true when config has no [generic] section', async () => {
    writeConfig(`
[defaults]
idp = "https://id.openape.at"
`)
    const { isGenericFallbackEnabled } = await import('../src/config.js')
    expect(isGenericFallbackEnabled()).toBe(true)
  })

  it('returns enabled=false when [generic] enabled = false', async () => {
    writeConfig(`
[generic]
enabled = false
`)
    const { isGenericFallbackEnabled } = await import('../src/config.js')
    expect(isGenericFallbackEnabled()).toBe(false)
  })

  it('returns enabled=true when [generic] enabled = true (explicit)', async () => {
    writeConfig(`
[generic]
enabled = true
`)
    const { isGenericFallbackEnabled } = await import('../src/config.js')
    expect(isGenericFallbackEnabled()).toBe(true)
  })

  it('accepts the generic config alongside defaults and agent sections', async () => {
    writeConfig(`
[defaults]
idp = "https://id.openape.at"

[agent]
email = "me@example.com"

[generic]
enabled = false
audit_log = "~/custom/generic.log"
`)
    const { loadConfig, isGenericFallbackEnabled, getGenericAuditLogPath } = await import('../src/config.js')
    const cfg = loadConfig()
    expect(cfg.defaults?.idp).toBe('https://id.openape.at')
    expect(cfg.agent?.email).toBe('me@example.com')
    expect(isGenericFallbackEnabled(cfg)).toBe(false)
    expect(getGenericAuditLogPath(cfg)).toBe(join(testHome, 'custom/generic.log'))
  })

  it('getGenericAuditLogPath defaults to ~/.config/apes/generic-calls.log', async () => {
    const { getGenericAuditLogPath } = await import('../src/config.js')
    expect(getGenericAuditLogPath()).toBe(join(testHome, '.config', 'apes', 'generic-calls.log'))
  })

  it('getGenericAuditLogPath expands ~ to HOME', async () => {
    writeConfig(`
[generic]
audit_log = "~/logs/apes.jsonl"
`)
    const { getGenericAuditLogPath } = await import('../src/config.js')
    expect(getGenericAuditLogPath()).toBe(join(testHome, 'logs', 'apes.jsonl'))
  })

  it('getGenericAuditLogPath leaves absolute paths untouched', async () => {
    writeConfig(`
[generic]
audit_log = "/var/log/apes/generic.jsonl"
`)
    const { getGenericAuditLogPath } = await import('../src/config.js')
    expect(getGenericAuditLogPath()).toBe('/var/log/apes/generic.jsonl')
  })
})
