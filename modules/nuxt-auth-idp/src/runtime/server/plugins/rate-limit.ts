import type { H3Event } from 'h3'
import type { NitroApp } from 'nitropack'
import { getRequestIP } from 'h3'

interface RateLimitEntry {
  count: number
  resetAt: number
}

const WINDOW_MS = 60_000 // 1 minute
const MAX_REQUESTS = 10

// Rate-limited path-prefixes. Anything brute-forceable (auth ceremonies,
// agent challenges, push subscriptions, account registration, user lookups)
// is in here. The hyphen in `my-agents` is escaped explicitly. Extended in
// #292 to cover the free-idp's custom paths (enroll, register, my-agents,
// push, users) which were previously unlimited — see audit 2026-05-04.
const RE_AUTH_PATHS = /^\/(?:api\/(?:session|auth|agent|webauthn|enroll|register|my-agents|push|users)\b|authorize\b|token\b)/

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

// IPv4 CIDR membership. IPv6 ranges are matched literally (no
// netmask) for now — most production proxy fleets are IPv4 anyway and
// IPv6 CIDR is a rare config. Returns false on parse errors.
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    const x = Number(p)
    if (!Number.isInteger(x) || x < 0 || x > 255) return null
    n = (n << 8) | x
  }
  // >>> 0 normalises to unsigned 32-bit so comparisons work after the
  // sign-bit flip on octets > 127.
  return n >>> 0
}

function ipMatches(ip: string, cidr: string): boolean {
  if (cidr === ip) return true
  if (!cidr.includes('/')) return false
  const [base, prefixStr] = cidr.split('/')
  if (!base || !prefixStr) return false
  const prefix = Number(prefixStr)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false
  const ipInt = ipv4ToInt(ip)
  const baseInt = ipv4ToInt(base)
  if (ipInt === null || baseInt === null) return false
  if (prefix === 0) return true
  const mask = ((1 << (32 - prefix)) - 1) ^ 0xFFFFFFFF
  return (ipInt & mask) === (baseInt & mask)
}

function ipInTrustedList(ip: string, trusted: string[]): boolean {
  return trusted.some(cidr => ipMatches(ip, cidr))
}

function parseTrustedProxies(): string[] {
  // Operators behind a real proxy (Vercel, Cloudflare, NGINX) opt-in
  // by setting OPENAPE_RATE_LIMIT_TRUSTED_PROXIES to a comma-separated
  // CIDR list. The default is empty — XFF is ignored and rate-limiting
  // keys on the socket peer. That's safe (a misconfigured deploy
  // rate-limits per-proxy instead of per-client; never per attacker-
  // chosen header value), and ahead of #279 we actively prefer this
  // failure mode to letting attackers spoof XFF and skip the limit.
  const raw = process.env.OPENAPE_RATE_LIMIT_TRUSTED_PROXIES
  if (!raw) return []
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * Resolve the rate-limit key IP. When the request's direct peer is in
 * the trusted-proxy list, walk the X-Forwarded-For chain right-to-left
 * skipping any IPs that are themselves trusted; the first untrusted
 * value is the real client. Otherwise return the socket peer.
 *
 * Why right-to-left: XFF is "client, proxy1, proxy2, …" appended in
 * arrival order. The closest hop (proxy2) is rightmost. If proxy2 is
 * trusted we move left; if it's untrusted, an attacker has injected
 * something or our proxy chain is misconfigured — bucket on that IP
 * anyway so they can't escape rate-limiting by lying.
 *
 * Replaces the previous `xForwardedFor: true` blanket-trust which let
 * attackers rotate the leftmost XFF value to bypass the auth-endpoint
 * cap (see security audit 2026-05-04, #279).
 */
function resolveClientIp(event: H3Event, trustedProxies: string[]): string {
  const peer = getRequestIP(event) || 'unknown'

  if (trustedProxies.length === 0) return peer
  if (peer === 'unknown') return peer
  if (!ipInTrustedList(peer, trustedProxies)) return peer

  const xff = event.node.req.headers['x-forwarded-for']
  const xffStr = Array.isArray(xff) ? xff.join(',') : xff
  if (!xffStr) return peer

  const chain = xffStr.split(',').map(s => s.trim()).filter(Boolean)
  for (let i = chain.length - 1; i >= 0; i--) {
    const candidate = chain[i]!
    if (!ipInTrustedList(candidate, trustedProxies)) return candidate
  }
  // Whole chain is trusted — fall back to peer.
  return peer
}

export default (nitroApp: NitroApp) => {
  // Skip rate limiting entirely in E2E test mode
  if (process.env.OPENAPE_E2E === '1') return

  const trustedProxies = parseTrustedProxies()

  nitroApp.hooks.hook('request', (event) => {
    const path = event.path || ''
    if (!RE_AUTH_PATHS.test(path)) return

    cleanup()

    const ip = resolveClientIp(event, trustedProxies)
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

// Exported for unit tests.
export const _internals = { ipv4ToInt, ipMatches, ipInTrustedList, resolveClientIp }
