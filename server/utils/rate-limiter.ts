import { createError } from 'h3'
import { eq } from 'drizzle-orm'
import { useDb } from './db'
import { rateLimits } from '../database/schema'

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
  const db = useDb()
  const now = Date.now()

  const row = await db.select().from(rateLimits).where(eq(rateLimits.key, key)).get()

  if (!row || now - row.windowStart > config.windowMs) {
    // New window
    await db.insert(rateLimits)
      .values({ key, count: 1, windowStart: now })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: { count: 1, windowStart: now },
      })
    return true
  }

  if (row.count >= config.maxRequests) {
    return false
  }

  await db.update(rateLimits)
    .set({ count: row.count + 1 })
    .where(eq(rateLimits.key, key))

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
