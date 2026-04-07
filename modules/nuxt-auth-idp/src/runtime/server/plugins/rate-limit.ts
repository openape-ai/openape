import type { NitroApp } from 'nitropack'
import { getRequestIP } from 'h3'

interface RateLimitEntry {
  count: number
  resetAt: number
}

const WINDOW_MS = 60_000 // 1 minute
const MAX_REQUESTS = 10

const RE_AUTH_PATHS = /^\/(?:api\/(?:session|auth|agent|webauthn)\b|authorize\b|token\b)/

const store = new Map<string, RateLimitEntry>()

// Periodic cleanup to prevent unbounded memory growth
let lastCleanup = Date.now()
const CLEANUP_INTERVAL_MS = 300_000 // 5 minutes

function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key)
    }
  }
}

export default (nitroApp: NitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    const path = event.path || ''
    if (!RE_AUTH_PATHS.test(path)) return

    cleanup()

    const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
    const key = `${ip}:auth`
    const now = Date.now()

    let entry = store.get(key)
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + WINDOW_MS }
      store.set(key, entry)
    }

    entry.count++

    const res = event.node.res
    res.setHeader('X-RateLimit-Limit', String(MAX_REQUESTS))
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, MAX_REQUESTS - entry.count)))
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))

    if (entry.count > MAX_REQUESTS) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
      res.setHeader('Retry-After', String(retryAfter))
      res.statusCode = 429
      res.setHeader('Content-Type', 'application/problem+json')
      res.end(JSON.stringify({
        type: 'about:blank',
        title: 'Too Many Requests',
        status: 429,
        detail: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
      }))
    }
  })
}
