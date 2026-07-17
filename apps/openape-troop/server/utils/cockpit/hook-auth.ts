import { createHmac, timingSafeEqual } from 'node:crypto'

// HMAC-SHA256 of the raw body, compared timing-safe against the X-Signature header
// (format "sha256=<hex>"). True only when a secret is set and the signature matches.
export function verifyHookSignature(secret: string, rawBody: string, header: string | undefined): boolean {
  if (!header) return false
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
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
