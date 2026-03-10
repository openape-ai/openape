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
  await db.run(sql`CREATE TABLE IF NOT EXISTS auth_codes (
    code TEXT PRIMARY KEY NOT NULL,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    user_id TEXT NOT NULL,
    nonce TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`)
  await db.run(sql`CREATE TABLE IF NOT EXISTS signing_keys (
    kid TEXT PRIMARY KEY NOT NULL,
    private_key_jwk TEXT NOT NULL,
    public_key_jwk TEXT NOT NULL,
    is_active INTEGER DEFAULT 1 NOT NULL,
    created_at INTEGER NOT NULL
  )`)
})

afterEach(() => {
  client.close()
})

describe('CodeStore (Drizzle)', () => {
  it('saves and retrieves an auth code', async () => {
    const entry = {
      code: 'test-code-123',
      clientId: 'sp.example.com',
      redirectUri: 'https://sp.example.com/callback',
      codeChallenge: 'challenge-value',
      userId: 'alice@example.com',
      nonce: 'test-nonce',
      expiresAt: Date.now() + 60_000,
    }

    await db.insert(schema.authCodes).values({
      code: entry.code,
      clientId: entry.clientId,
      redirectUri: entry.redirectUri,
      codeChallenge: entry.codeChallenge,
      userId: entry.userId,
      nonce: entry.nonce,
      expiresAt: entry.expiresAt,
    })

    const row = await db.select().from(schema.authCodes).where(eq(schema.authCodes.code, 'test-code-123')).get()
    expect(row).not.toBeNull()
    expect(row!.clientId).toBe('sp.example.com')
    expect(row!.userId).toBe('alice@example.com')
    expect(row!.nonce).toBe('test-nonce')
  })

  it('returns null for non-existent code', async () => {
    const row = await db.select().from(schema.authCodes).where(eq(schema.authCodes.code, 'does-not-exist')).get()
    expect(row).toBeUndefined()
  })

  it('deletes a code (single use)', async () => {
    await db.insert(schema.authCodes).values({
      code: 'delete-me',
      clientId: 'sp',
      redirectUri: 'https://sp/cb',
      codeChallenge: 'ch',
      userId: 'user@example.com',
      nonce: 'n',
      expiresAt: Date.now() + 60_000,
    })

    await db.delete(schema.authCodes).where(eq(schema.authCodes.code, 'delete-me'))

    const row = await db.select().from(schema.authCodes).where(eq(schema.authCodes.code, 'delete-me')).get()
    expect(row).toBeUndefined()
  })

  it('identifies expired codes', async () => {
    await db.insert(schema.authCodes).values({
      code: 'expired-code',
      clientId: 'sp',
      redirectUri: 'https://sp/cb',
      codeChallenge: 'ch',
      userId: 'user@example.com',
      nonce: 'n',
      expiresAt: Date.now() - 1000,
    })

    const row = await db.select().from(schema.authCodes).where(eq(schema.authCodes.code, 'expired-code')).get()
    expect(row).not.toBeUndefined()
    expect(row!.expiresAt).toBeLessThan(Date.now())
  })
})

describe('SigningKeys (Drizzle)', () => {
  it('stores and retrieves signing keys', async () => {
    await db.insert(schema.signingKeys).values({
      kid: 'key-1',
      privateKeyJwk: JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'd' }),
      publicKeyJwk: JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'x', y: 'y' }),
      isActive: true,
      createdAt: Date.now(),
    })

    const rows = await db.select().from(schema.signingKeys).where(eq(schema.signingKeys.isActive, true)).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].kid).toBe('key-1')

    const parsed = JSON.parse(rows[0].publicKeyJwk)
    expect(parsed.kty).toBe('EC')
  })

  it('filters inactive keys', async () => {
    await db.insert(schema.signingKeys).values({
      kid: 'active-key',
      privateKeyJwk: '{}',
      publicKeyJwk: '{}',
      isActive: true,
      createdAt: Date.now(),
    })
    await db.insert(schema.signingKeys).values({
      kid: 'inactive-key',
      privateKeyJwk: '{}',
      publicKeyJwk: '{}',
      isActive: false,
      createdAt: Date.now(),
    })

    const rows = await db.select().from(schema.signingKeys).where(eq(schema.signingKeys.isActive, true)).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].kid).toBe('active-key')
  })
})
