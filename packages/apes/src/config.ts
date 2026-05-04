import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface AuthData {
  idp: string
  access_token: string
  refresh_token?: string
  email: string
  expires_at: number
  /**
   * Set by `apes login --key …` (and `apes agents spawn`), absolute
   * path to the Ed25519 key the agent signs challenges with. Lets
   * `@openape/cli-auth` refresh agent tokens in-process; see #259.
   */
  key_path?: string
  /**
   * Email of the human who owns this agent — written by
   * `apes agents spawn`. The chat-bridge reads it for owner-only
   * contact handshakes. Optional for human auth.json files.
   */
  owner_email?: string
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
  /**
   * Generic-fallback mode: when `apes run -- <cli>` is called with a CLI
   * that has no registered shape, fall through to a synthetic adapter that
   * requests a single-use, forced-high-risk grant for the exact argv.
   * See `shapes/generic.ts`.
   */
  generic?: {
    /**
     * Master switch. Default `true` (permissive). Set to `false` to restore
     * the legacy "No adapter found" hard-fail. Stored as string in TOML
     * (hand-parser limitation) and parsed as `value !== 'false'` at read time.
     */
    enabled?: string
    /** Override the audit-log location. Default `~/.config/apes/generic-calls.log`. Tilde-expanded at read time. */
    audit_log?: string
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
  // Preserve unmodelled fields from any prior version of auth.json
  // (e.g. older installs of this package, or fields a sibling CLI
  // wrote). Symmetric with cli-auth's saveIdpAuth — see #257 for the
  // bridge crash-loop the bare overwrite caused before.
  let extra: Record<string, unknown> = {}
  if (existsSync(AUTH_FILE)) {
    try {
      const raw = readFileSync(AUTH_FILE, 'utf-8')
      if (raw.trim()) {
        const prev = JSON.parse(raw) as Record<string, unknown>
        for (const key of Object.keys(prev)) {
          if (!(key in (data as unknown as Record<string, unknown>))) {
            extra[key] = prev[key]
          }
        }
      }
    }
    catch {
      extra = {}
    }
  }
  const merged = { ...extra, ...data }
  writeFileSync(AUTH_FILE, JSON.stringify(merged, null, 2), { mode: 0o600 })
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

    // Accept quoted strings and bare booleans/tokens — the generic section
    // uses `enabled = false` (no quotes) which the quoted-only match would
    // silently drop.
    const kvQuoted = trimmed.match(/^(\w+)\s*=\s*"(.*)"$/)
    const kvBare = trimmed.match(/^(\w+)\s*=\s*([^"\s]\S*)$/)
    const kvMatch = kvQuoted ?? kvBare
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
      else if (section === 'generic') {
        config.generic = config.generic || {}
        ;(config.generic as Record<string, string>)[key!] = value!
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

  if (config.generic) {
    lines.push('[generic]')
    for (const [key, value] of Object.entries(config.generic)) {
      if (value)
        lines.push(`${key} = "${value}"`)
    }
    lines.push('')
  }

  writeFileSync(CONFIG_FILE, lines.join('\n'), { mode: 0o600 })
}

/**
 * Is generic-fallback enabled? Permissive default: `true` unless the user
 * explicitly sets `[generic] enabled = false`.
 */
export function isGenericFallbackEnabled(config?: ApesConfig): boolean {
  const cfg = config ?? loadConfig()
  const raw = cfg.generic?.enabled
  if (raw === undefined) return true
  return raw !== 'false'
}

/**
 * Resolve the audit-log path for generic calls, expanding `~` to `$HOME`.
 */
export function getGenericAuditLogPath(config?: ApesConfig): string {
  const cfg = config ?? loadConfig()
  const raw = cfg.generic?.audit_log
  const path = raw && raw.length > 0
    ? raw
    : join(homedir(), '.config', 'apes', 'generic-calls.log')
  return path.startsWith('~/')
    ? join(homedir(), path.slice(2))
    : path
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
