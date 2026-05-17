import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import consola from 'consola'

/**
 * Compare the running apes version against the latest published on npm
 * and warn the user if they're behind. Skipped silently when:
 *   - the env var APES_NO_UPDATE_CHECK is set (CI, scripts that are
 *     deliberate about pin)
 *   - the cached lookup is fresh (24h TTL — npm registry rate-limit
 *     friendly and the warning is annoying if it fires every command)
 *   - the network call fails (offline, dns down, npm hiccup) — no
 *     warning is more useful than a confusing one
 *
 * Cached state lives at `~/.config/apes/.version-check.json`:
 *   { latest: "0.21.2", checkedAt: 1714770000 }
 *
 * Called from cli.ts at process start. Async-fire-and-forget — the
 * actual command runs immediately; the warning prints when the lookup
 * completes (usually <100ms, well before any human-in-the-loop step).
 */

const PACKAGE_NAME = '@openape/apes'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_FILE = join(homedir(), '.config', 'apes', '.version-check.json')

interface CacheEntry {
  latest: string
  checkedAt: number
}

function readCache(): CacheEntry | null {
  if (!existsSync(CACHE_FILE)) return null
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as CacheEntry
  }
  catch {
    return null
  }
}

function writeCache(entry: CacheEntry): void {
  try {
    const dir = join(homedir(), '.config', 'apes')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(CACHE_FILE, JSON.stringify(entry), { mode: 0o600 })
  }
  catch { /* best effort */ }
}

/**
 * Tiny semver compare — assumes valid x.y.z (no pre-release suffixes for
 * apes). Returns negative if a < b, 0 if equal, positive if a > b.
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x - y
  }
  return 0
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    // Plain `application/json` — the vnd.npm.install-v1+json variant is
    // only valid on the full package endpoint, NOT on /latest (returns 406).
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}/latest`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(2_000),
    })
    if (!res.ok) return null
    const body = await res.json() as { version?: string }
    return typeof body.version === 'string' ? body.version : null
  }
  catch {
    return null
  }
}

function warnIfBehind(currentVersion: string, latest: string): void {
  if (compareSemver(currentVersion, latest) < 0) {
    consola.warn(
      `apes ${currentVersion} is behind latest @openape/apes@${latest}. `
      + `Run \`npm i -g @openape/apes@latest\` to update. `
      + `(Suppress with APES_NO_UPDATE_CHECK=1.)`,
    )
  }
}

/**
 * Two-phase check so users see the warning immediately when something
 * is known stale, without paying network latency on every command:
 *
 *   1. Synchronous cache read. If the cache is fresh AND says we're
 *      behind, warn now. Most calls hit this path with zero latency.
 *   2. Async refresh in the background (fire-and-forget, doesn't
 *      block the actual command). Updates cache for the next call.
 *      If no cache existed at all (first run), this won't print on
 *      this invocation — but the next invocation will see the cache.
 *
 * Bypass with `APES_NO_UPDATE_CHECK=1` (CI, scripts pinning a version).
 */
export async function maybeWarnStaleVersion(currentVersion: string): Promise<void> {
  if (process.env.APES_NO_UPDATE_CHECK) return
  if (!currentVersion || currentVersion === 'unknown') return

  const cached = readCache()
  const now = Date.now()

  if (cached) {
    warnIfBehind(currentVersion, cached.latest)
  }

  if (!cached || now - cached.checkedAt >= CACHE_TTL_MS) {
    const latest = await fetchLatestVersion()
    if (latest) {
      writeCache({ latest, checkedAt: now })
      if (!cached) warnIfBehind(currentVersion, latest)
    }
  }
}
