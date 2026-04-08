import { createError } from 'h3'

interface RateLimitEntry {
  count: number
  windowStart: number
}

interface RateLimitConfig {
  maxRequests: number
  windowMs: number
}

const LIMITS = {
  email: { maxRequests: 3, windowMs: 15 * 60 * 1000 } satisfies RateLimitConfig,
  ip: { maxRequests: 10, windowMs: 15 * 60 * 1000 } satisfies RateLimitConfig,
  global: { maxRequests: 500, windowMs: 60 * 60 * 1000 } satisfies RateLimitConfig,
}

const entries = new Map<string, RateLimitEntry>()

function checkLimit(key: string, config: RateLimitConfig): boolean {
  const now = Date.now()
  const entry = entries.get(key)

  if (!entry || now - entry.windowStart > config.windowMs) {
    entries.set(key, { count: 1, windowStart: now })
    return true
  }

  if (entry.count >= config.maxRequests) {
    return false
  }

  entry.count++
  return true
}

export function checkRateLimit(email: string, ip: string): void {
  const emailOk = checkLimit(`email:${email}`, LIMITS.email)
  const ipOk = checkLimit(`ip:${ip}`, LIMITS.ip)
  const globalOk = checkLimit('global', LIMITS.global)

  if (!emailOk || !ipOk || !globalOk) {
    throw createError({ statusCode: 429, statusMessage: 'Too many requests' })
  }
}
