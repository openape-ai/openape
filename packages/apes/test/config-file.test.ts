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

describe('config file', () => {
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

  it('ignores writable HOME configuration only in an explicitly managed runtime', async () => {
    writeConfig('[notifications]\npending_command = "printf harmless-fixture"\n')
    const { loadConfig } = await import('../src/config.js')
    expect(loadConfig().notifications?.pending_command).toBe('printf harmless-fixture')
    try {
      vi.stubEnv('APES_IGNORE_USER_CONFIG', '1')
      expect(loadConfig()).toEqual({})
      vi.stubEnv('APES_IGNORE_USER_CONFIG', 'false')
      expect(loadConfig).toThrow('APES_IGNORE_USER_CONFIG')
    }
    finally { vi.unstubAllEnvs() }
  })

  it('ignores a legacy [generic] section and keeps the other sections', async () => {
    writeConfig(`
[defaults]
idp = "https://id.openape.at"

[agent]
email = "me@example.com"

[generic]
enabled = false
audit_log = "~/custom/generic.log"
`)
    const { loadConfig } = await import('../src/config.js')
    expect(loadConfig()).toEqual({
      defaults: { idp: 'https://id.openape.at' },
      agent: { email: 'me@example.com' },
    })
  })
})
