import type { H3Event } from 'h3'
import { setResponseHeader } from 'h3'
import { createProblemError } from './problem'

interface Window {
  count: number
  resetAt: number
}

const WINDOW_MS = 60_000
const CLEANUP_INTERVAL_MS = 300_000
// Every program call of an agent asks here; Pods and apes reuse a command
// token until it expires, so a generous per-agent budget suffices.
const DEFAULT_MAX_AUTHORIZE = 600

const windows = new Map<string, Window>()
let lastCleanup = Date.now()

function maxRequests(): number {
  const raw = Number(process.env.OPENAPE_RATE_LIMIT_MAX_AUTHORIZE)
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_AUTHORIZE
}

function cleanup(now: number): void {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now
  for (const [key, entry] of windows) {
    if (entry.resetAt <= now) windows.delete(key)
  }
}

/**
 * Per-requester budget of `POST /api/grants/authorize` and the `authorize`
 * broker operation, keyed by the verified token (or broker-signed) subject.
 * It never shares a bucket with sign-in or the per-IP limiter, so many
 * program calls cannot lock the owner out of the IdP.
 */
export function enforceAuthorizeRateLimit(event: H3Event, subject: string): void {
  const now = Date.now()
  cleanup(now)
  const limit = maxRequests()
  let entry = windows.get(subject)
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + WINDOW_MS }
    windows.set(subject, entry)
  }
  entry.count++
  setResponseHeader(event, 'X-RateLimit-Limit', String(limit))
  setResponseHeader(event, 'X-RateLimit-Remaining', String(Math.max(0, limit - entry.count)))
  if (entry.count <= limit) return
  const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
  setResponseHeader(event, 'Retry-After', retryAfter)
  throw createProblemError({ status: 429, title: 'Too many authorization requests', type: 'https://openape.org/errors/rate_limited', detail: `Try again in ${retryAfter} seconds.` })
}

/** Clears all windows; for tests only. */
export function resetAuthorizeRateLimit(): void {
  windows.clear()
}
