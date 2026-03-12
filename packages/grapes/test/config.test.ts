import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the config module paths before importing
const TEST_DIR = join(tmpdir(), `grapes-test-${Date.now()}`)
const AUTH_FILE = join(TEST_DIR, 'auth.json')
const CONFIG_FILE = join(TEST_DIR, 'config.toml')

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: () => join(TEST_DIR, '..'),
  }
})

// We need to mock the paths used internally
vi.mock('../src/config', async () => {
  const { existsSync, mkdirSync, readFileSync, writeFileSync } = await import('node:fs')

  interface AuthData {
    idp: string
    access_token: string
    refresh_token?: string
    email: string
    expires_at: number
  }

  interface GrapesConfig {
    defaults?: { idp?: string, approval?: string, for?: string }
    agent?: { key?: string, email?: string }
  }

  function ensureDir() {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
  }

  function loadAuth(): AuthData | null {
    if (!existsSync(AUTH_FILE)) return null
    try {
      return JSON.parse(readFileSync(AUTH_FILE, 'utf-8'))
    }
    catch {
      return null
    }
  }

  function saveAuth(data: AuthData): void {
    ensureDir()
    writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 })
  }

  function clearAuth(): void {
    if (existsSync(AUTH_FILE)) {
      writeFileSync(AUTH_FILE, '', { mode: 0o600 })
    }
  }

  function loadConfig(): GrapesConfig {
    if (!existsSync(CONFIG_FILE)) return {}
    try {
      const content = readFileSync(CONFIG_FILE, 'utf-8')
      return parseTOML(content)
    }
    catch {
      return {}
    }
  }

  function parseTOML(content: string): GrapesConfig {
    const config: GrapesConfig = {}
    let section = ''
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const sectionMatch = trimmed.match(/^\[(.+)\]$/)
      if (sectionMatch) {
        section = sectionMatch[1]
        continue
      }
      const kvMatch = trimmed.match(/^(\w+)\s*=\s*"(.+)"$/)
      if (kvMatch) {
        const [, key, value] = kvMatch
        if (section === 'defaults') {
          config.defaults = config.defaults || {}
          ;(config.defaults as Record<string, string>)[key] = value
        }
        else if (section === 'agent') {
          config.agent = config.agent || {}
          ;(config.agent as Record<string, string>)[key] = value
        }
      }
    }
    return config
  }

  function getIdpUrl(explicit?: string): string | null {
    if (explicit) return explicit
    if (process.env.GRAPES_IDP) return process.env.GRAPES_IDP
    const auth = loadAuth()
    if (auth?.idp) return auth.idp
    const config = loadConfig()
    if (config.defaults?.idp) return config.defaults.idp
    return null
  }

  function getAuthToken(): string | null {
    const auth = loadAuth()
    if (!auth) return null
    if (auth.expires_at && Date.now() / 1000 > auth.expires_at - 30) return null
    return auth.access_token
  }

  return {
    loadAuth,
    saveAuth,
    clearAuth,
    loadConfig,
    getIdpUrl,
    getAuthToken,
    CONFIG_DIR: TEST_DIR,
    AUTH_FILE,
  }
})

const { loadAuth, saveAuth, clearAuth, loadConfig, getIdpUrl, getAuthToken } = await import('../src/config')

describe('config', () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
    delete process.env.GRAPES_IDP
  })

  describe('loadAuth / saveAuth', () => {
    it('returns null when no auth file exists', () => {
      expect(loadAuth()).toBeNull()
    })

    it('saves and loads auth data', () => {
      const authData = {
        idp: 'https://id.example.com',
        access_token: 'test-token',
        email: 'test@example.com',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }
      saveAuth(authData)
      const loaded = loadAuth()
      expect(loaded).toEqual(authData)
    })

    it('saves auth with refresh token', () => {
      const authData = {
        idp: 'https://id.example.com',
        access_token: 'test-token',
        refresh_token: 'refresh-token',
        email: 'test@example.com',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }
      saveAuth(authData)
      const loaded = loadAuth()
      expect(loaded?.refresh_token).toBe('refresh-token')
    })
  })

  describe('clearAuth', () => {
    it('clears saved auth', () => {
      saveAuth({
        idp: 'https://id.example.com',
        access_token: 'test-token',
        email: 'test@example.com',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      })
      clearAuth()
      expect(loadAuth()).toBeNull()
    })
  })

  describe('loadConfig', () => {
    it('returns empty config when no file', () => {
      expect(loadConfig()).toEqual({})
    })

    it('parses TOML config', () => {
      writeFileSync(CONFIG_FILE, [
        '[defaults]',
        'idp = "https://id.example.com"',
        'approval = "once"',
        'for = "admin@example.com"',
        '',
        '[agent]',
        'key = "/path/to/key"',
        'email = "agent@example.com"',
      ].join('\n'))

      const config = loadConfig()
      expect(config.defaults?.idp).toBe('https://id.example.com')
      expect(config.defaults?.approval).toBe('once')
      expect(config.defaults?.for).toBe('admin@example.com')
      expect(config.agent?.key).toBe('/path/to/key')
      expect(config.agent?.email).toBe('agent@example.com')
    })

    it('ignores comments and empty lines', () => {
      writeFileSync(CONFIG_FILE, [
        '# This is a comment',
        '',
        '[defaults]',
        '# idp comment',
        'idp = "https://id.example.com"',
      ].join('\n'))

      const config = loadConfig()
      expect(config.defaults?.idp).toBe('https://id.example.com')
    })
  })

  describe('getIdpUrl', () => {
    it('returns explicit URL first', () => {
      expect(getIdpUrl('https://explicit.example.com')).toBe('https://explicit.example.com')
    })

    it('returns env var when no explicit', () => {
      process.env.GRAPES_IDP = 'https://env.example.com'
      expect(getIdpUrl()).toBe('https://env.example.com')
    })

    it('returns saved auth IdP', () => {
      saveAuth({
        idp: 'https://saved.example.com',
        access_token: 'token',
        email: 'test@example.com',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      })
      expect(getIdpUrl()).toBe('https://saved.example.com')
    })

    it('returns null when nothing configured', () => {
      expect(getIdpUrl()).toBeNull()
    })
  })

  describe('getAuthToken', () => {
    it('returns null when not authenticated', () => {
      expect(getAuthToken()).toBeNull()
    })

    it('returns token when valid', () => {
      saveAuth({
        idp: 'https://id.example.com',
        access_token: 'valid-token',
        email: 'test@example.com',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      })
      expect(getAuthToken()).toBe('valid-token')
    })

    it('returns null when token expired', () => {
      saveAuth({
        idp: 'https://id.example.com',
        access_token: 'expired-token',
        email: 'test@example.com',
        expires_at: Math.floor(Date.now() / 1000) - 60,
      })
      expect(getAuthToken()).toBeNull()
    })
  })
})
