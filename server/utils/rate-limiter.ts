import { createError } from 'h3'
import { useStorage } from 'nitropack/runtime'

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

async function checkLimit(key: string, config: RateLimitConfig): Promise<boolean> {
  const storage = useStorage('idp')
  const storageKey = `rate-limits:${key}`
  const now = Date.now()

  const entry = await storage.getItem<RateLimitEntry>(storageKey)

  if (!entry || now - entry.windowStart > config.windowMs) {
    await storage.setItem(storageKey, { count: 1, windowStart: now })
    return true
  }

  if (entry.count >= config.maxRequests) {
    return false
  }

  await storage.setItem(storageKey, { count: entry.count + 1, windowStart: entry.windowStart })
  return true
}

export async function checkRateLimit(email: string, ip: string): Promise<void> {
  const emailOk = await checkLimit(`email:${email}`, LIMITS.email)
  const ipOk = await checkLimit(`ip:${ip}`, LIMITS.ip)
  const globalOk = await checkLimit('global', LIMITS.global)

  if (!emailOk || !ipOk || !globalOk) {
    throw createError({ statusCode: 429, statusMessage: 'Too many requests' })
  }
}
