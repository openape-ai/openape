import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { useDb } from './db'
import { magicLinkTokens } from '../database/schema'

export interface MagicLinkToken {
  token: string
  email: string
  expiresAt: number
}

const TOKEN_TTL = 10 * 60 * 1000 // 10 minutes

export function generateMagicToken(): string {
  return randomBytes(32).toString('base64url')
}

export async function saveMagicLinkToken(email: string): Promise<string> {
  const db = useDb()
  const token = generateMagicToken()
  const expiresAt = Date.now() + TOKEN_TTL

  await db.insert(magicLinkTokens).values({ token, email, expiresAt })

  return token
}

export async function consumeMagicLinkToken(token: string): Promise<string | null> {
  const db = useDb()
  const row = await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.token, token)).get()

  if (!row) return null

  // Delete immediately (one-time use)
  await db.delete(magicLinkTokens).where(eq(magicLinkTokens.token, token))

  if (row.expiresAt < Date.now()) return null

  return row.email
}
