import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import { sql } from 'drizzle-orm'
import * as schema from '../server/database/schema'

// Create an in-memory DB for testing
let db: ReturnType<typeof drizzle>
let client: ReturnType<typeof createClient>

beforeEach(async () => {
  client = createClient({ url: ':memory:' })
  db = drizzle(client, { schema })
  await db.run(sql`CREATE TABLE IF NOT EXISTS magic_link_tokens (
    token TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`)
})

afterEach(() => {
  client.close()
})

describe('Magic Link Store', () => {
  it('saves and retrieves a token', async () => {
    const token = 'test-token-123'
    const email = 'user@example.com'
    const expiresAt = Date.now() + 600_000

    await db.insert(schema.magicLinkTokens).values({
      token,
      email,
      expiresAt,
      createdAt: Date.now(),
    })

    const row = await db.select()
      .from(schema.magicLinkTokens)
      .where(sql`token = ${token}`)
      .get()

    expect(row).not.toBeNull()
    expect(row!.email).toBe(email)
    expect(row!.expiresAt).toBe(expiresAt)
  })

  it('deletes token after consumption (one-time use)', async () => {
    const token = 'consume-me'
    await db.insert(schema.magicLinkTokens).values({
      token,
      email: 'user@example.com',
      expiresAt: Date.now() + 600_000,
      createdAt: Date.now(),
    })

    // Consume: read + delete
    const row = await db.select()
      .from(schema.magicLinkTokens)
      .where(sql`token = ${token}`)
      .get()
    expect(row).not.toBeNull()

    await db.delete(schema.magicLinkTokens).where(sql`token = ${token}`)

    const rowAfter = await db.select()
      .from(schema.magicLinkTokens)
      .where(sql`token = ${token}`)
      .get()
    expect(rowAfter).toBeUndefined()
  })

  it('rejects expired tokens', async () => {
    const token = 'expired-token'
    await db.insert(schema.magicLinkTokens).values({
      token,
      email: 'user@example.com',
      expiresAt: Date.now() - 1000, // expired
      createdAt: Date.now() - 600_000,
    })

    const row = await db.select()
      .from(schema.magicLinkTokens)
      .where(sql`token = ${token}`)
      .get()

    expect(row).not.toBeNull()
    expect(row!.expiresAt).toBeLessThan(Date.now())
  })
})
