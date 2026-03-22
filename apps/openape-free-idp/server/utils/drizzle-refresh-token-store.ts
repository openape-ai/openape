import { createHash, randomBytes } from 'node:crypto'
import type { RefreshConsumeResult, RefreshTokenFamily, RefreshTokenResult, RefreshTokenStore } from '@openape/auth'
import { and, eq, gt } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { refreshTokenFamilies, refreshTokens } from '../database/schema'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url')
}

const DEFAULT_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export function createDrizzleRefreshTokenStore(): RefreshTokenStore {
  const db = useDb()

  return {
    async create(userId: string, clientId: string, ttlMs?: number): Promise<RefreshTokenResult> {
      const token = generateRefreshToken()
      const tokenHash = hashToken(token)
      const familyId = randomBytes(16).toString('hex')
      const now = Date.now()
      const expiresAt = now + (ttlMs ?? DEFAULT_REFRESH_TTL_MS)

      await db.insert(refreshTokenFamilies).values({
        familyId,
        userId,
        clientId,
        currentTokenHash: tokenHash,
        createdAt: now,
        expiresAt,
        revoked: false,
      })

      await db.insert(refreshTokens).values({
        tokenHash,
        familyId,
        userId,
        clientId,
        expiresAt,
        used: false,
      })

      return { token, familyId }
    },

    async consume(token: string): Promise<RefreshConsumeResult> {
      const tokenHash = hashToken(token)
      const entry = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash)).get()

      if (!entry) {
        throw new Error('Invalid refresh token')
      }

      const family = await db.select().from(refreshTokenFamilies).where(eq(refreshTokenFamilies.familyId, entry.familyId)).get()
      if (!family || family.revoked) {
        throw new Error('Token family revoked')
      }

      if (entry.expiresAt < Date.now()) {
        throw new Error('Refresh token expired')
      }

      // Replay detection: if token was already used, revoke entire family
      if (entry.used) {
        await db.update(refreshTokenFamilies).set({ revoked: true }).where(eq(refreshTokenFamilies.familyId, entry.familyId))
        throw new Error('Refresh token reuse detected — family revoked')
      }

      // Mark current token as used
      await db.update(refreshTokens).set({ used: true }).where(eq(refreshTokens.tokenHash, tokenHash))

      // Generate new token in same family
      const newToken = generateRefreshToken()
      const newHash = hashToken(newToken)

      await db.insert(refreshTokens).values({
        tokenHash: newHash,
        familyId: entry.familyId,
        userId: entry.userId,
        clientId: entry.clientId,
        expiresAt: family.expiresAt,
        used: false,
      })

      await db.update(refreshTokenFamilies).set({ currentTokenHash: newHash }).where(eq(refreshTokenFamilies.familyId, entry.familyId))

      return {
        newToken,
        userId: entry.userId,
        clientId: entry.clientId,
        familyId: entry.familyId,
      }
    },

    async revokeByToken(token: string): Promise<void> {
      const tokenHash = hashToken(token)
      const entry = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash)).get()
      if (entry) {
        await db.update(refreshTokenFamilies).set({ revoked: true }).where(eq(refreshTokenFamilies.familyId, entry.familyId))
      }
    },

    async revokeFamily(familyId: string): Promise<void> {
      await db.update(refreshTokenFamilies).set({ revoked: true }).where(eq(refreshTokenFamilies.familyId, familyId))
    },

    async revokeByUser(userId: string): Promise<void> {
      await db.update(refreshTokenFamilies).set({ revoked: true }).where(
        and(eq(refreshTokenFamilies.userId, userId), eq(refreshTokenFamilies.revoked, false)),
      )
    },

    async listFamilies(userId?: string): Promise<RefreshTokenFamily[]> {
      const now = Date.now()
      const conditions = [
        eq(refreshTokenFamilies.revoked, false),
        gt(refreshTokenFamilies.expiresAt, now),
      ]
      if (userId) {
        conditions.push(eq(refreshTokenFamilies.userId, userId))
      }

      const rows = await db.select().from(refreshTokenFamilies).where(and(...conditions))
      return rows.map(row => ({
        familyId: row.familyId,
        userId: row.userId,
        clientId: row.clientId,
        currentTokenHash: row.currentTokenHash,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        revoked: row.revoked,
      }))
    },
  }
}
