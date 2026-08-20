import type { H3Event } from 'h3'
import type { NitroApp } from 'nitropack'
import { getRequestIP } from 'h3'
import { renderErrorPage, wantsHtmlErrorPage } from '../utils/error-page'

interface RateLimitEntry {
  count: number
  resetAt: number
}

const WINDOW_MS = 60_000 // 1 minute
const DEFAULT_MAX_REQUESTS = 10
// Agents re-authenticate (challenge → authenticate) on a token-expiry
// cadence, and many agents owned by one human share that human's egress
// IP. Their machine traffic must not consume the human's strict
// brute-force budget, so `/api/agent/*` gets its OWN per-IP bucket with a
// higher default. Tunable via OPENAPE_RATE_LIMIT_MAX_AGENT.
const DEFAULT_MAX_AGENT = 120
// Authenticated owner-management APIs (my-agents, users) are legitimate
// bulk targets — an owner cleaning up 33 stale agent identities is not a
// brute-force attack. Before #1073 they drained the strict 10/min pot and
// silently 429'd the owner's own browser login from the same IP.
const DEFAULT_MAX_MANAGEMENT = 60

// Per-IP auth cap for the window. Operators whose legitimate traffic
// drives many auth ceremonies from one client IP (e.g. the local demo
// stack, compose/local-stack.yml, where one headless browser walks every
// app's SSO + account flow inside a minute) can raise it via
// OPENAPE_RATE_LIMIT_MAX_AUTH without disabling the limiter outright.
// Anything unset/invalid keeps the audited default of 10/min.
function parseMaxRequests(): number {
  const raw = Number(process.env.OPENAPE_RATE_LIMIT_MAX_AUTH)
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_REQUESTS
}

// Separate, higher cap for agent challenge/authenticate traffic.
function parseMaxAgentRequests(): number {
  const raw = Number(process.env.OPENAPE_RATE_LIMIT_MAX_AGENT)
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_AGENT
}

// Separate cap for authenticated owner-management traffic.
function parseMaxManagementRequests(): number {
  const raw = Number(process.env.OPENAPE_RATE_LIMIT_MAX_MANAGEMENT)
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_MANAGEMENT
}

// QR sign-in traffic: the kiosk polls its claim endpoint every 2 s while
// waiting for the phone (~30/min), plus channel creation and the phone's
// context/approve calls. Legitimate by design, so it must not drain the
// strict per-IP login budget — the same starvation #1073 fixed for
// management APIs. Guessing tokens here is hopeless anyway (64-hex,
// timing-safe), the bucket only bounds storage churn.
const DEFAULT_MAX_QR = 90

function parseMaxQrRequests(): number {
  const raw = Number(process.env.OPENAPE_RATE_LIMIT_MAX_QR)
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_QR
}

// Rate-limited path-prefixes. Anything brute-forceable (auth ceremonies,
// agent challenges, push subscriptions, account registration, user lookups)
// is in here. The hyphen in `my-agents` is escaped explicitly. Extended in
// #292 to cover the free-idp's custom paths (enroll, register, my-agents,
// push, users) which were previously unlimited — see audit 2026-05-04.
const RE_AUTH_PATHS = /^\/(?:api\/(?:session|auth|agent|webauthn|enroll|register|my-agents|push|users|grants)\b|authorize\b|token\b)/

// Machine-auth paths. These get the separate, higher-capacity bucket so
// machine re-auth never throttles the human browser login from the same
// IP. `/token` belongs here (#1073): it is either agent auth via signed
// `client_assertion` (not guessable, so no brute-force target) or OIDC
// code exchange (the code is single-use and short-lived) — but it IS the
// path that many agent identities behind ONE egress IP hit every minute.
// `/api/grants` rides the agent bucket too (#1276): grant requests are
// machine traffic (many per minute behind one egress IP) and must not
// drain the human login budget — same #1073 reasoning as /token.
const RE_AGENT_PATHS = /^\/(?:api\/(?:agent|grants)\b|token\b)/

// Authenticated owner-management APIs. Bulk operations here (deleting 33
// stale agents, listing users) are legitimate owner work, not credential
// guessing — they must not compete with the strict login budget (#1073).
//
// Deliberately still keyed per-IP, NOT per-`sub` from the Bearer token:
// the limiter runs before any token verification, so an unverified `sub`
// would be attacker-chosen — rotating it would bypass the limit entirely.
// Identity-based keying would require verified tokens inside the limiter.
const RE_MANAGEMENT_PATHS = /^\/api\/(?:my-agents|users)\b/

// QR sign-in endpoints (subset of /api/session, so checked first).
const RE_QR_PATHS = /^\/api\/session\/qr\b/

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
  const maxAuth = parseMaxRequests()
  const maxAgent = parseMaxAgentRequests()
  const maxManagement = parseMaxManagementRequests()
  const maxQr = parseMaxQrRequests()

  nitroApp.hooks.hook('request', (event) => {
    const path = event.path || ''
    if (!RE_AUTH_PATHS.test(path)) return

    cleanup()

    const ip = resolveClientIp(event, trustedProxies)
    // Three per-IP buckets, split by the NATURE of the traffic (#1073):
    // strict = unauthenticated credential ceremonies (brute-forceable),
    // agent = machine auth (/api/agent/*, /token),
    // management = authenticated owner APIs (/api/my-agents, /api/users).
    // Machine work must never drain the human login budget or vice versa.
    let bucket: 'agent' | 'mgmt' | 'auth' | 'qr'
    let maxRequests: number
    if (RE_QR_PATHS.test(path)) {
      bucket = 'qr'
      maxRequests = maxQr
    }
    else if (RE_AGENT_PATHS.test(path)) {
      bucket = 'agent'
      maxRequests = maxAgent
    }
    else if (RE_MANAGEMENT_PATHS.test(path)) {
      bucket = 'mgmt'
      maxRequests = maxManagement
    }
    else {
      bucket = 'auth'
      maxRequests = maxAuth
    }
    const key = `${ip}:${bucket}`
    const now = Date.now()

    let entry = store.get(key)
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + WINDOW_MS }
      store.set(key, entry)
    }

    entry.count++

    const res = event.node.res
    res.setHeader('X-RateLimit-Limit', String(maxRequests))
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequests - entry.count)))
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
      res.setHeader('Retry-After', String(retryAfter))
      res.statusCode = 429

      // Browser navigations get a readable page with the wait time
      // (#1074); API clients keep the problem+json below unchanged.
      if (wantsHtmlErrorPage(event.node.req.headers)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(renderErrorPage(429, { retryAfterSeconds: retryAfter }))
        return
      }

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
export const _internals = { ipv4ToInt, ipMatches, ipInTrustedList, resolveClientIp, parseMaxRequests, parseMaxManagementRequests }
