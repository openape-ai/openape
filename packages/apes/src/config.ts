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
    /**
     * Audience for the `apes run` async info block. `agent` (default)
     * emits verbose agent-facing instructions with a polling protocol;
     * `human` emits a short friendly block. Env var `APES_USER` wins.
     */
    user?: 'agent' | 'human'
    /**
     * Poll interval (seconds) embedded in the agent-mode instructions.
     * Default 10. Env var `APES_GRANT_POLL_INTERVAL` wins. Stored as a
     * string in TOML because the hand-rolled parser only handles quoted
     * values — casting to number happens at read time.
     */
    grant_poll_interval_seconds?: string
    /**
     * Maximum poll duration (minutes) embedded in the agent-mode
     * instructions. Default 5. Env var `APES_GRANT_POLL_MAX_MINUTES` wins.
     */
    grant_poll_max_minutes?: string
    /**
     * Exit code emitted by `apes run` / `ape-shell -c` when the async
     * default path creates a pending grant. Default `75` (`EX_TEMPFAIL`
     * from sysexits.h — "temporary failure, retry later"). Set to `0`
     * to restore the pre-0.10.0 exit-0 behaviour. Env var
     * `APES_ASYNC_EXIT_CODE` wins. Valid range 0–255.
     */
    async_exit_code?: string
  }
  agent?: {
    key?: string
    email?: string
  }
  notifications?: {
    pending_command?: string
  }
}

const CONFIG_DIR = join(homedir(), '.config', 'apes')
const AUTH_FILE = join(CONFIG_DIR, 'auth.json')
const CONFIG_FILE = join(CONFIG_DIR, 'config.toml')

function ensureDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

export function loadAuth(): AuthData | null {
  if (!existsSync(AUTH_FILE))
    return null
  try {
    return JSON.parse(readFileSync(AUTH_FILE, 'utf-8'))
  }
  catch {
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
  // Also wipe the [agent] section from config.toml so logout disables
  // auto-refresh. Preserves [defaults] so the IdP URL stays configured.
  if (existsSync(CONFIG_FILE)) {
    const existing = loadConfig()
    if (existing.agent) {
      const { agent: _removed, ...rest } = existing
      saveConfig(rest)
    }
  }
}

export function loadConfig(): ApesConfig {
  if (!existsSync(CONFIG_FILE))
    return {}
  try {
    return parseTOML(readFileSync(CONFIG_FILE, 'utf-8'))
  }
  catch {
    return {}
  }
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
      else if (section === 'notifications') {
        config.notifications = config.notifications || {}
        ;(config.notifications as Record<string, string>)[key!] = value!
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

  if (config.notifications) {
    lines.push('[notifications]')
    for (const [key, value] of Object.entries(config.notifications)) {
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
