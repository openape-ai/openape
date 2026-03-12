import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import { eq, sql } from 'drizzle-orm'
import * as schema from '../server/database/schema'

let db: ReturnType<typeof drizzle>
let client: ReturnType<typeof createClient>

beforeEach(async () => {
  client = createClient({ url: ':memory:' })
  db = drizzle(client, { schema })
  await db.run(sql`CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY NOT NULL,
    count INTEGER DEFAULT 0 NOT NULL,
    window_start INTEGER NOT NULL
  )`)
})

afterEach(() => {
  client.close()
})

async function checkLimit(key: string, maxRequests: number, windowMs: number): Promise<boolean> {
  const now = Date.now()
  const row = await db.select().from(schema.rateLimits).where(eq(schema.rateLimits.key, key)).get()

  if (!row || now - row.windowStart > windowMs) {
    await db.insert(schema.rateLimits)
      .values({ key, count: 1, windowStart: now })
      .onConflictDoUpdate({
        target: schema.rateLimits.key,
        set: { count: 1, windowStart: now },
      })
    return true
  }

  if (row.count >= maxRequests) {
    return false
  }

  await db.update(schema.rateLimits)
    .set({ count: row.count + 1 })
    .where(eq(schema.rateLimits.key, key))

  return true
}

describe('Rate Limiter', () => {
  it('allows requests within limit', async () => {
    expect(await checkLimit('email:test@example.com', 3, 900_000)).toBe(true)
    expect(await checkLimit('email:test@example.com', 3, 900_000)).toBe(true)
    expect(await checkLimit('email:test@example.com', 3, 900_000)).toBe(true)
  })

  it('blocks 4th request within window for per-email limit', async () => {
    expect(await checkLimit('email:test@example.com', 3, 900_000)).toBe(true)
    expect(await checkLimit('email:test@example.com', 3, 900_000)).toBe(true)
    expect(await checkLimit('email:test@example.com', 3, 900_000)).toBe(true)
    expect(await checkLimit('email:test@example.com', 3, 900_000)).toBe(false)
  })

  it('resets after window expires', async () => {
    // Manually insert an expired window
    await db.insert(schema.rateLimits).values({
      key: 'email:expired@example.com',
      count: 3,
      windowStart: Date.now() - 1_000_000, // well past the 900_000ms window
    })

    expect(await checkLimit('email:expired@example.com', 3, 900_000)).toBe(true)
  })

  it('tracks different keys independently', async () => {
    expect(await checkLimit('email:a@example.com', 3, 900_000)).toBe(true)
    expect(await checkLimit('email:a@example.com', 3, 900_000)).toBe(true)
    expect(await checkLimit('email:a@example.com', 3, 900_000)).toBe(true)
    expect(await checkLimit('email:a@example.com', 3, 900_000)).toBe(false)

    // Different email should still work
    expect(await checkLimit('email:b@example.com', 3, 900_000)).toBe(true)
  })

  it('handles IP rate limits', async () => {
    for (let i = 0; i < 10; i++) {
      expect(await checkLimit('ip:192.168.1.1', 10, 900_000)).toBe(true)
    }
    expect(await checkLimit('ip:192.168.1.1', 10, 900_000)).toBe(false)
  })
})
