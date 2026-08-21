import { assertPublicUrl } from '@openape/core'

export interface CheckResult {
  up: boolean
  statusCode: number | null
  latencyMs: number | null
  error: string | null
}

/** Requests time out after this — a hung connection counts as down. */
const FETCH_TIMEOUT_MS = 10_000

/**
 * A monitor is due when it has never been checked, or when its interval has
 * elapsed since the last check.
 */
export function isDue(m: { lastCheckedAt: number | null, intervalSec: number }, nowSec: number): boolean {
  if (m.lastCheckedAt == null) return true
  return nowSec >= m.lastCheckedAt + m.intervalSec
}

/**
 * Heartbeat monitors invert the direction: nothing is fetched, the watched
 * process pings us, and `intervalSec` becomes the freshness budget — the
 * longest a ping may be missing before the monitor counts as down.
 *
 * A monitor that has never been pinged is down. That is the honest reading:
 * we have no evidence it is alive, and treating "no news" as good is exactly
 * the failure this check exists to prevent.
 */
export function checkHeartbeat(m: { lastPingAt: number | null, intervalSec: number }, nowSec: number): CheckResult {
  if (m.lastPingAt == null)
    return { up: false, statusCode: null, latencyMs: null, error: 'No ping received yet' }

  const ageSec = nowSec - m.lastPingAt
  if (ageSec <= m.intervalSec)
    return { up: true, statusCode: null, latencyMs: null, error: null }

  return {
    up: false,
    statusCode: null,
    latencyMs: null,
    error: `Last ping ${ageSec}s ago, budget is ${m.intervalSec}s`,
  }
}

/**
 * Map an HTTP status to up/down. 2xx–3xx = up; 4xx/5xx = down. A monitored URL
 * answering 401/404/500 is reachable but not "healthy" for an alive-test, which
 * is the same convention uptime services use by default.
 * ponytail: no per-monitor "expected status" override — add when someone needs it.
 */
export function isUpStatus(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 400
}

/**
 * Fetch a URL once and classify the outcome. Re-runs the SSRF guard on every
 * call (not just at create time) so a hostname that later resolves to a private
 * address can't be used to probe the internal network. GET, not HEAD: some
 * hosts mishandle HEAD, and the body is discarded anyway.
 */
export async function checkOnce(url: string): Promise<CheckResult> {
  try {
    await assertPublicUrl(url)
  }
  catch (err) {
    return { up: false, statusCode: null, latencyMs: null, error: (err as Error).message }
  }

  const started = Date.now()
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': 'OpenApeMonitor/1.0 (+https://monitor.openape.ai)' },
    })
    return { up: isUpStatus(res.status), statusCode: res.status, latencyMs: Date.now() - started, error: null }
  }
  catch (err) {
    return {
      up: false,
      statusCode: null,
      latencyMs: Date.now() - started,
      error: (err as Error).name === 'TimeoutError' ? 'Timed out' : (err as Error).message,
    }
  }
}
