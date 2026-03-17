import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface AuthData {
  idp: string
  access_token: string
  refresh_token?: string
  email: string
  expires_at: number
}

export interface GrapesConfig {
  defaults?: {
    idp?: string
    approval?: string
  }
  agent?: {
    key?: string
    email?: string
  }
}

const CONFIG_DIR = join(homedir(), '.config', 'grapes')
const AUTH_FILE = join(CONFIG_DIR, 'auth.json')
const CONFIG_FILE = join(CONFIG_DIR, 'config.toml')

function ensureDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

export function loadAuth(): AuthData | null {
  if (!existsSync(AUTH_FILE)) return null
  try {
    return JSON.parse(readFileSync(AUTH_FILE, 'utf-8'))
  } catch {
    return null
  }
}

export function saveAuth(data: AuthData): void {
  ensureDir()
  writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 })
}

export function clearAuth(): void {
  if (existsSync(AUTH_FILE)) {
    writeFileSync(AUTH_FILE, '', { mode: 0o600 })
  }
}

export function loadConfig(): GrapesConfig {
  if (!existsSync(CONFIG_FILE)) return {}
  try {
    const content = readFileSync(CONFIG_FILE, 'utf-8')
    // Simple TOML parsing for flat config
    return parseTOML(content)
  } catch {
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
      } else if (section === 'agent') {
        config.agent = config.agent || {}
        ;(config.agent as Record<string, string>)[key] = value
      }
    }
  }

  return config
}

export function getIdpUrl(explicit?: string): string | null {
  if (explicit) return explicit
  if (process.env.GRAPES_IDP) return process.env.GRAPES_IDP

  const auth = loadAuth()
  if (auth?.idp) return auth.idp

  const config = loadConfig()
  if (config.defaults?.idp) return config.defaults.idp

  return null
}

export function getAuthToken(): string | null {
  const auth = loadAuth()
  if (!auth) return null

  // Check expiry (with 30s buffer)
  if (auth.expires_at && Date.now() / 1000 > auth.expires_at - 30) {
    return null // expired
  }

  return auth.access_token
}

export { CONFIG_DIR, AUTH_FILE }
