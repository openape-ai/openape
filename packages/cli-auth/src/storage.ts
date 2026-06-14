import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { IdpAuth, SpToken } from './types.js'

/**
 * Resolve the OpenApe CLI auth home (`~/.config/apes/` by default).
 *
 * Precedence:
 * 1. Explicit `authHome` — an OS home directory; the config dir is its
 *    `.config/apes`. The single-process Nest passes each hosted agent's home
 *    so one daemon can read every agent's own `auth.json`, instead of all
 *    sharing the daemon's home or a process-wide env var.
 * 2. `OPENAPE_CLI_AUTH_HOME` env var (the full config dir; used by tests + CI).
 * 3. `~/.config/apes` of the current process.
 *
 * Read on every call so tests can mutate `process.env` between cases. When
 * `authHome` is omitted the behaviour is byte-identical to before.
 */
export function getConfigDir(authHome?: string): string {
  if (authHome) return join(authHome, '.config', 'apes')
  const override = process.env.OPENAPE_CLI_AUTH_HOME
  if (override) return override
  return join(homedir(), '.config', 'apes')
}

export function getAuthFile(authHome?: string): string {
  return join(getConfigDir(authHome), 'auth.json')
}

export function getSpTokensDir(): string {
  return join(getConfigDir(), 'sp-tokens')
}

function ensureConfigDir(authHome?: string): void {
  const dir = getConfigDir(authHome)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
}

function ensureSpTokensDir(): void {
  ensureConfigDir()
  const dir = getSpTokensDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
}

export function loadIdpAuth(authHome?: string): IdpAuth | null {
  const file = getAuthFile(authHome)
  if (!existsSync(file)) return null
  try {
    const raw = readFileSync(file, 'utf-8')
    if (!raw.trim()) return null
    return JSON.parse(raw) as IdpAuth
  }
  catch {
    return null
  }
}

export function saveIdpAuth(auth: IdpAuth, authHome?: string): void {
  ensureConfigDir(authHome)
  // Preserve fields the IdpAuth type doesn't model — primarily
  // `owner_email`, written by `apes agents spawn` so the bridge can
  // tell who the agent belongs to. Without this merge, every call to
  // `apes login` (e.g. from the bridge's start.sh on each daemon boot)
  // would silently drop owner_email and the bridge would crash-loop
  // with "auth.json missing 'owner_email'".
  const file = getAuthFile(authHome)
  let extra: Record<string, unknown> = {}
  if (existsSync(file)) {
    try {
      const raw = readFileSync(file, 'utf-8')
      if (raw.trim()) {
        const prev = JSON.parse(raw) as Record<string, unknown>
        for (const key of Object.keys(prev)) {
          if (!(key in (auth as unknown as Record<string, unknown>))) {
            extra[key] = prev[key]
          }
        }
      }
    }
    catch {
      extra = {}
    }
  }
  const merged = { ...extra, ...auth }
  writeFileSync(file, JSON.stringify(merged, null, 2), { mode: 0o600 })
}

export function clearIdpAuth(): void {
  const file = getAuthFile()
  if (existsSync(file)) {
    writeFileSync(file, '', { mode: 0o600 })
  }
}

/**
 * Filename-safe representation of an audience. Audiences are typically
 * hostnames like `plans.openape.ai` — already filesystem-safe — but we
 * defensively replace anything outside `[A-Za-z0-9._-]`.
 */
function audToFilename(aud: string): string {
  return aud.replace(/[^\w.-]/g, '_')
}

function spTokenPath(aud: string): string {
  return join(getSpTokensDir(), `${audToFilename(aud)}.json`)
}

export function loadSpToken(aud: string): SpToken | null {
  const path = spTokenPath(aud)
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf-8')
    if (!raw.trim()) return null
    return JSON.parse(raw) as SpToken
  }
  catch {
    return null
  }
}

export function saveSpToken(token: SpToken): void {
  ensureSpTokensDir()
  writeFileSync(spTokenPath(token.aud), JSON.stringify(token, null, 2), { mode: 0o600 })
}

export function clearSpToken(aud: string): void {
  const path = spTokenPath(aud)
  if (existsSync(path)) unlinkSync(path)
}

/** Wipe every cached SP-token. Called by `apes logout` to ensure a clean slate. */
export function clearAllSpTokens(): void {
  const dir = getSpTokensDir()
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    if (entry.endsWith('.json')) {
      try { unlinkSync(join(dir, entry)) }
      catch { /* best effort */ }
    }
  }
}
