import { loadConfig } from './config.js'
import { apiFetch, getGrantsEndpoint } from './http.js'

/**
 * Shared poll-config helpers used by both the one-shot grant-creation
 * wait loops in `commands/run.ts` and the CLI-side wait loop in
 * `commands/grants/run.ts --wait`.
 *
 * Source-of-truth for the default poll interval (10 s) and max-wait
 * duration (5 min). Env var wins over config.toml wins over baked-in
 * default; bogus values fall back gracefully.
 */

/** Poll interval (seconds). Default 10. */
export function getPollIntervalSeconds(): number {
  const envValue = process.env.APES_GRANT_POLL_INTERVAL
  if (envValue) {
    const n = Number(envValue)
    if (Number.isFinite(n) && n > 0)
      return Math.floor(n)
  }
  const cfg = loadConfig()
  const cfgValue = cfg.defaults?.grant_poll_interval_seconds
  if (cfgValue) {
    const n = Number(cfgValue)
    if (Number.isFinite(n) && n > 0)
      return Math.floor(n)
  }
  return 10
}

/** Maximum poll duration (minutes). Default 5. */
export function getPollMaxMinutes(): number {
  const envValue = process.env.APES_GRANT_POLL_MAX_MINUTES
  if (envValue) {
    const n = Number(envValue)
    if (Number.isFinite(n) && n > 0)
      return Math.floor(n)
  }
  const cfg = loadConfig()
  const cfgValue = cfg.defaults?.grant_poll_max_minutes
  if (cfgValue) {
    const n = Number(cfgValue)
    if (Number.isFinite(n) && n > 0)
      return Math.floor(n)
  }
  return 5
}

/** Outcome of a grant polling loop. */
export type PollOutcome =
  | { kind: 'approved' }
  | { kind: 'terminal', status: 'denied' | 'revoked' | 'used' }
  | { kind: 'timeout' }

/**
 * Poll a specific grant's status via `GET /grants/<id>` until it reaches
 * a terminal state or the max-wait budget is exhausted. Uses the shared
 * `getPollIntervalSeconds` / `getPollMaxMinutes` knobs so users get
 * consistent behavior across both the grant-creation wait loops and the
 * CLI-side `grants run --wait` loop.
 *
 * The caller is responsible for handling the outcome — this helper only
 * polls the status endpoint, it does not dispatch or execute the grant.
 * See `commands/grants/run.ts --wait` for the dispatch path.
 */
export async function pollGrantUntilResolved(
  idp: string,
  grantId: string,
): Promise<PollOutcome> {
  const grantsEndpoint = await getGrantsEndpoint(idp)
  const intervalSec = getPollIntervalSeconds()
  const maxMinutes = getPollMaxMinutes()
  const maxMs = maxMinutes * 60_000
  const intervalMs = intervalSec * 1000
  const start = Date.now()

  while (Date.now() - start < maxMs) {
    const grant = await apiFetch<{ status: string }>(`${grantsEndpoint}/${grantId}`)
    if (grant.status === 'approved')
      return { kind: 'approved' }
    if (grant.status === 'denied' || grant.status === 'revoked' || grant.status === 'used')
      return { kind: 'terminal', status: grant.status }
    await new Promise(r => setTimeout(r, intervalMs))
  }

  return { kind: 'timeout' }
}
