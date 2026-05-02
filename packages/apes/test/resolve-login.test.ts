import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import consola from 'consola'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Isolate HOME so config.ts and resolveLoginInputs see an empty world by default.
const testHome = join(tmpdir(), `apes-resolve-login-${process.pid}-${Date.now()}`)
mkdirSync(testHome, { recursive: true })
mkdirSync(join(testHome, '.ssh'), { recursive: true })

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  return { ...original, homedir: () => testHome }
})

const ENV_KEYS = ['APES_KEY', 'APES_EMAIL', 'APES_IDP', 'GRAPES_IDP', 'DDISA_MOCK_RECORDS'] as const
const originalEnv: Record<string, string | undefined> = {}
for (const k of ENV_KEYS) originalEnv[k] = process.env[k]

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k]
}

function writeKeyPair(name: string, comment: string | null) {
  const privPath = join(testHome, name)
  const pubPath = `${privPath}.pub`
  writeFileSync(privPath, 'dummy-private-key', { mode: 0o600 })
  const pubContent = comment === null
    ? 'ssh-ed25519 AAAAC3Nzbase64body'
    : `ssh-ed25519 AAAAC3Nzbase64body ${comment}`
  writeFileSync(pubPath, `${pubContent}\n`)
  return { privPath, pubPath }
}

function clearConfig() {
  const configDir = join(testHome, '.config', 'apes')
  rmSync(configDir, { recursive: true, force: true })
}

function writeConfig(toml: string) {
  const configDir = join(testHome, '.config', 'apes')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, 'config.toml'), toml)
}

describe('resolveLoginInputs', () => {
  beforeEach(() => {
    clearEnv()
    clearConfig()
    // Remove any leftover keys from previous cases
    rmSync(join(testHome, '.ssh'), { recursive: true, force: true })
    mkdirSync(join(testHome, '.ssh'), { recursive: true })
  })

  afterEach(() => {
    clearEnv()
    clearConfig()
  })

  afterAll(() => {
    rmSync(testHome, { recursive: true, force: true })
    for (const k of ENV_KEYS) {
      if (originalEnv[k] === undefined) delete process.env[k]
      else process.env[k] = originalEnv[k]
    }
  })

  it('derives key, email and IdP from defaults + pub comment + DDISA', async () => {
    writeKeyPair('.ssh/id_ed25519', 'alice@example.test')
    process.env.DDISA_MOCK_RECORDS = JSON.stringify({
      'example.test': { idp: 'https://idp.example.test' },
    })

    const { resolveLoginInputs } = await import('../src/commands/auth/resolve-login')
    const result = await resolveLoginInputs({})

    expect(result.keyPath).toBe(join(testHome, '.ssh', 'id_ed25519'))
    expect(result.email).toBe('alice@example.test')
    expect(result.idp).toBe('https://idp.example.test')
  })

  it('returns no keyPath when no default key exists', async () => {
    const { resolveLoginInputs } = await import('../src/commands/auth/resolve-login')
    const result = await resolveLoginInputs({})

    expect(result.keyPath).toBeUndefined()
    expect(result.email).toBeUndefined()
  })

  it('does not use pub comment as email when comment has no @', async () => {
    writeKeyPair('.ssh/id_ed25519', 'host-only-label')

    const { resolveLoginInputs } = await import('../src/commands/auth/resolve-login')
    const result = await resolveLoginInputs({})

    expect(result.keyPath).toBe(join(testHome, '.ssh', 'id_ed25519'))
    expect(result.email).toBeUndefined()
  })

  it('handles missing .pub file gracefully', async () => {
    // Write only the private key, no pub file
    writeFileSync(join(testHome, '.ssh', 'id_ed25519'), 'dummy', { mode: 0o600 })

    const { resolveLoginInputs } = await import('../src/commands/auth/resolve-login')
    const result = await resolveLoginInputs({})

    expect(result.keyPath).toBe(join(testHome, '.ssh', 'id_ed25519'))
    expect(result.email).toBeUndefined()
  })

  it('explicit flags override all fallback sources', async () => {
    writeKeyPair('.ssh/id_ed25519', 'fallback@example.test')
    writeConfig('[agent]\nemail = "config@example.test"\nkey = "/from/config"\n\n[defaults]\nidp = "https://config-idp.example.test"\n')
    process.env.APES_KEY = '/from/env'
    process.env.APES_EMAIL = 'env@example.test'
    process.env.APES_IDP = 'https://env-idp.example.test'

    const { resolveLoginInputs } = await import('../src/commands/auth/resolve-login')
    const result = await resolveLoginInputs({
      key: '/explicit/key',
      email: 'explicit@example.test',
      idp: 'https://explicit-idp.example.test',
    })

    expect(result.keyPath).toBe('/explicit/key')
    expect(result.email).toBe('explicit@example.test')
    expect(result.idp).toBe('https://explicit-idp.example.test')
  })

  it('env vars win over config when no flag is given', async () => {
    writeConfig('[agent]\nkey = "/from/config"\nemail = "config@example.test"\n\n[defaults]\nidp = "https://config-idp.example.test"\n')
    process.env.APES_KEY = '/from/env'
    process.env.APES_EMAIL = 'env@example.test'
    process.env.APES_IDP = 'https://env-idp.example.test'

    const { resolveLoginInputs } = await import('../src/commands/auth/resolve-login')
    const result = await resolveLoginInputs({})

    expect(result.keyPath).toBe('/from/env')
    expect(result.email).toBe('env@example.test')
    expect(result.idp).toBe('https://env-idp.example.test')
  })

  it('config values fill in when env is absent', async () => {
    writeConfig('[agent]\nkey = "/from/config"\nemail = "config@example.test"\n\n[defaults]\nidp = "https://config-idp.example.test"\n')

    const { resolveLoginInputs } = await import('../src/commands/auth/resolve-login')
    const result = await resolveLoginInputs({})

    expect(result.keyPath).toBe('/from/config')
    expect(result.email).toBe('config@example.test')
    expect(result.idp).toBe('https://config-idp.example.test')
  })

  it('browser flag skips key resolution entirely', async () => {
    writeKeyPair('.ssh/id_ed25519', 'alice@example.test')
    process.env.APES_IDP = 'https://env-idp.example.test'

    const { resolveLoginInputs } = await import('../src/commands/auth/resolve-login')
    const result = await resolveLoginInputs({ browser: true })

    expect(result.keyPath).toBeUndefined()
    // Email from pub comment requires keyPath → also undefined
    expect(result.email).toBeUndefined()
    expect(result.idp).toBe('https://env-idp.example.test')
  })

  it('GRAPES_IDP is honored as a fallback alias for APES_IDP', async () => {
    process.env.GRAPES_IDP = 'https://grapes-idp.example.test'
    const warnSpy = vi.spyOn(consola, 'warn').mockImplementation(() => {})

    const { resolveLoginInputs } = await import('../src/commands/auth/resolve-login')
    const result = await resolveLoginInputs({})

    expect(result.idp).toBe('https://grapes-idp.example.test')
    // Deprecation hint must fire when the fallback is actually used.
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/GRAPES_IDP is deprecated/)
    warnSpy.mockRestore()
  })

  it('APES_IDP wins over GRAPES_IDP and emits a duplicate warning', async () => {
    process.env.APES_IDP = 'https://apes-idp.example.test'
    process.env.GRAPES_IDP = 'https://grapes-idp.example.test'
    const warnSpy = vi.spyOn(consola, 'warn').mockImplementation(() => {})

    const { resolveLoginInputs } = await import('../src/commands/auth/resolve-login')
    const result = await resolveLoginInputs({})

    expect(result.idp).toBe('https://apes-idp.example.test')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/Both APES_IDP and GRAPES_IDP/)
    warnSpy.mockRestore()
  })

  describe('ddisaMismatch', () => {
    it('flags mismatch when --idp differs from DDISA', async () => {
      process.env.DDISA_MOCK_RECORDS = JSON.stringify({
        'hofmann.example': { idp: 'https://id.openape.ai', mode: 'open' },
      })
      const { resolveLoginInputs } = await import('../src/commands/auth/resolve-login')

      const result = await resolveLoginInputs({
        email: 'patrick@hofmann.example',
        idp: 'https://id.openape.at',
        browser: true, // skip key resolution to keep the test focused
      })

      expect(result.idp).toBe('https://id.openape.at')
      expect(result.ddisaMismatch).toEqual({
        dnsIdp: 'https://id.openape.ai',
        chosenIdp: 'https://id.openape.at',
        domain: 'hofmann.example',
      })
    })

    it('no mismatch when --idp matches DDISA', async () => {
      process.env.DDISA_MOCK_RECORDS = JSON.stringify({
        'hofmann.example': { idp: 'https://id.openape.ai', mode: 'open' },
      })
      const { resolveLoginInputs } = await import('../src/commands/auth/resolve-login')

      const result = await resolveLoginInputs({
        email: 'patrick@hofmann.example',
        idp: 'https://id.openape.ai',
        browser: true,
      })

      expect(result.ddisaMismatch).toBeUndefined()
    })

    it('no mismatch when IdP is auto-discovered from DDISA (no explicit override)', async () => {
      process.env.DDISA_MOCK_RECORDS = JSON.stringify({
        'hofmann.example': { idp: 'https://id.openape.ai', mode: 'open' },
      })
      const { resolveLoginInputs } = await import('../src/commands/auth/resolve-login')

      const result = await resolveLoginInputs({
        email: 'patrick@hofmann.example',
        browser: true,
      })

      expect(result.idp).toBe('https://id.openape.ai')
      expect(result.ddisaMismatch).toBeUndefined()
    })

    it('no mismatch when domain has no DDISA record (fallback path)', async () => {
      // No DDISA_MOCK_RECORDS — resolveDDISA returns null
      const { resolveLoginInputs } = await import('../src/commands/auth/resolve-login')

      const result = await resolveLoginInputs({
        email: 'patrick@unknown.example',
        idp: 'https://id.openape.at',
        browser: true,
      })

      expect(result.idp).toBe('https://id.openape.at')
      expect(result.ddisaMismatch).toBeUndefined()
    })
  })
})

describe('readPublicKeyComment', () => {
  const pubDir = join(testHome, 'pub-tests')

  beforeEach(() => {
    mkdirSync(pubDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(pubDir, { recursive: true, force: true })
  })

  it('returns null when file does not exist', async () => {
    const { readPublicKeyComment } = await import('../src/ssh-key')
    expect(readPublicKeyComment(join(pubDir, 'nope.pub'))).toBeNull()
  })

  it('returns the comment field when present', async () => {
    const file = join(pubDir, 'k.pub')
    writeFileSync(file, 'ssh-ed25519 AAAAC3Nzbase64body patrick@delta-mind.at\n')
    const { readPublicKeyComment } = await import('../src/ssh-key')
    expect(readPublicKeyComment(file)).toBe('patrick@delta-mind.at')
  })

  it('returns null when no comment is present', async () => {
    const file = join(pubDir, 'k.pub')
    writeFileSync(file, 'ssh-ed25519 AAAAC3Nzbase64body\n')
    const { readPublicKeyComment } = await import('../src/ssh-key')
    expect(readPublicKeyComment(file)).toBeNull()
  })

  it('rejoins multi-word comments', async () => {
    const file = join(pubDir, 'k.pub')
    writeFileSync(file, 'ssh-ed25519 AAAAC3Nzbase64body patrick on macbook\n')
    const { readPublicKeyComment } = await import('../src/ssh-key')
    expect(readPublicKeyComment(file)).toBe('patrick on macbook')
  })
})
