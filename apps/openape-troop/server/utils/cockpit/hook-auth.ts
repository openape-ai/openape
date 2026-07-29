import { createHmac, timingSafeEqual } from 'node:crypto'

// HMAC-SHA256 of the raw body, compared timing-safe against the X-Signature header
// (format "sha256=<hex>"). True only when a secret is set and the signature matches.
export function verifyHookSignature(secret: string, rawBody: string, header: string | undefined, allowUnprefixed = false): boolean {
  if (!header) return false
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  const normalized = allowUnprefixed && /^[\da-f]{64}$/i.test(header) ? `sha256=${header}` : header
  const a = Buffer.from(normalized)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Event gate. A hook is built for one kind of event, but senders like Forgejo post
// every event they know to the same URL — a push then runs an issues prompt and the
// Operator reports that nothing was to do. An empty filter keeps the old
// accept-everything behaviour; a set filter means the sender MUST name a listed event.
export function hookAcceptsEvent(filter: string | null | undefined, eventName: string | undefined): boolean {
  const allowed = (filter ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (allowed.length === 0) return true
  return allowed.includes((eventName ?? '').trim().toLowerCase())
}

// Per-token fixed-window rate limit (in-memory, single-replica). Returns true if
// the call is allowed. Only real tokens ever enter the map (callers gate on hook
// existence first), so it stays bounded by the number of hooks.
const HITS = new Map<string, { count: number, resetAt: number }>()
export function allowHookHit(token: string, now: number, maxPerWindow = 60, windowMs = 60_000): boolean {
  const e = HITS.get(token)
  if (!e || e.resetAt <= now) {
    HITS.set(token, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (e.count >= maxPerWindow) return false
  e.count++
  return true
}
