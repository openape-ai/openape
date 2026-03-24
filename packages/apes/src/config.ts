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

export interface ApesConfig {
  defaults?: {
    idp?: string
    approval?: string
  }
  agent?: {
    key?: string
    email?: string
  }
}

const CONFIG_DIR = join(homedir(), '.config', 'apes')
const AUTH_FILE = join(CONFIG_DIR, 'auth.json')
const CONFIG_FILE = join(CONFIG_DIR, 'config.toml')

const GRAPES_CONFIG_DIR = join(homedir(), '.config', 'grapes')
const GRAPES_AUTH_FILE = join(GRAPES_CONFIG_DIR, 'auth.json')
const GRAPES_CONFIG_FILE = join(GRAPES_CONFIG_DIR, 'config.toml')

function ensureDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

export function loadAuth(): AuthData | null {
  // Apes config first
  if (existsSync(AUTH_FILE)) {
    try {
      return JSON.parse(readFileSync(AUTH_FILE, 'utf-8'))
    }
    catch {}
  }

  // Fallback to grapes config
  if (existsSync(GRAPES_AUTH_FILE)) {
    try {
      return JSON.parse(readFileSync(GRAPES_AUTH_FILE, 'utf-8'))
    }
    catch {}
  }

  return null
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

export function loadConfig(): ApesConfig {
  // Apes config first
  if (existsSync(CONFIG_FILE)) {
    try {
      return parseTOML(readFileSync(CONFIG_FILE, 'utf-8'))
    }
    catch {}
  }

  // Fallback to grapes config
  if (existsSync(GRAPES_CONFIG_FILE)) {
    try {
      return parseTOML(readFileSync(GRAPES_CONFIG_FILE, 'utf-8'))
    }
    catch {}
  }

  return {}
}

function parseTOML(content: string): ApesConfig {
  const config: ApesConfig = {}
  let section = ''

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#'))
      continue

    const sectionMatch = trimmed.match(/^\[(.+)\]$/)
    if (sectionMatch) {
      section = sectionMatch[1]!
      continue
    }

    const kvMatch = trimmed.match(/^(\w+)\s*=\s*"(.+)"$/)
    if (kvMatch) {
      const [, key, value] = kvMatch
      if (section === 'defaults') {
        config.defaults = config.defaults || {}
        ;(config.defaults as Record<string, string>)[key!] = value!
      }
      else if (section === 'agent') {
        config.agent = config.agent || {}
        ;(config.agent as Record<string, string>)[key!] = value!
      }
    }
  }

  return config
}

export function saveConfig(config: ApesConfig): void {
  ensureDir()
  const lines: string[] = []

  if (config.defaults) {
    lines.push('[defaults]')
    for (const [key, value] of Object.entries(config.defaults)) {
      if (value)
        lines.push(`${key} = "${value}"`)
    }
    lines.push('')
  }

  if (config.agent) {
    lines.push('[agent]')
    for (const [key, value] of Object.entries(config.agent)) {
      if (value)
        lines.push(`${key} = "${value}"`)
    }
    lines.push('')
  }

  writeFileSync(CONFIG_FILE, lines.join('\n'), { mode: 0o600 })
}

export function getIdpUrl(explicit?: string): string | null {
  if (explicit)
    return explicit
  if (process.env.APES_IDP)
    return process.env.APES_IDP
  if (process.env.GRAPES_IDP)
    return process.env.GRAPES_IDP

  const auth = loadAuth()
  if (auth?.idp)
    return auth.idp

  const config = loadConfig()
  if (config.defaults?.idp)
    return config.defaults.idp

  return null
}

export function getAuthToken(): string | null {
  const auth = loadAuth()
  if (!auth)
    return null

  // Check expiry (with 30s buffer)
  if (auth.expires_at && Date.now() / 1000 > auth.expires_at - 30) {
    return null // expired
  }

  return auth.access_token
}

export function getRequesterIdentity(): string | null {
  return loadAuth()?.email ?? null
}

export { CONFIG_DIR, AUTH_FILE }
