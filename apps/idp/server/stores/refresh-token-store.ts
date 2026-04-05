import { createHash, randomBytes } from 'node:crypto'
import type { RefreshConsumeResult, RefreshTokenListOptions, RefreshTokenListResult, RefreshTokenResult, RefreshTokenStore } from '@openape/auth'
import { and, desc, eq, gt, lt } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { refreshTokenFamilies, refreshTokens } from '../database/schema'
import type * as schema from '../database/schema'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url')
}

const DEFAULT_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export function createDrizzleRefreshTokenStore(db: LibSQLDatabase<typeof schema>): RefreshTokenStore {
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

      if (entry.used) {
        await db.update(refreshTokenFamilies).set({ revoked: true }).where(eq(refreshTokenFamilies.familyId, entry.familyId))
        throw new Error('Refresh token reuse detected — family revoked')
      }

      await db.update(refreshTokens).set({ used: true }).where(eq(refreshTokens.tokenHash, tokenHash))

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

    async listFamilies(options?: RefreshTokenListOptions | string): Promise<RefreshTokenListResult> {
      const opts: RefreshTokenListOptions = typeof options === 'string' ? { userId: options } : (options ?? {})
      const now = Date.now()
      const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100)

      const conditions = [
        eq(refreshTokenFamilies.revoked, false),
        gt(refreshTokenFamilies.expiresAt, now),
      ]
      if (opts.userId) {
        conditions.push(eq(refreshTokenFamilies.userId, opts.userId))
      }

      // Cursor pagination: fetch families with createdAt less than the cursor family's createdAt
      if (opts.cursor) {
        const cursorFamily = await db.select({ createdAt: refreshTokenFamilies.createdAt }).from(refreshTokenFamilies).where(eq(refreshTokenFamilies.familyId, opts.cursor)).get()
        if (cursorFamily) {
          conditions.push(lt(refreshTokenFamilies.createdAt, cursorFamily.createdAt))
        }
      }

      const rows = await db.select().from(refreshTokenFamilies).where(and(...conditions)).orderBy(desc(refreshTokenFamilies.createdAt)).limit(limit + 1)

      const hasMore = rows.length > limit
      const data = rows.slice(0, limit).map(row => ({
        familyId: row.familyId,
        userId: row.userId,
        clientId: row.clientId,
        currentTokenHash: row.currentTokenHash,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        revoked: row.revoked,
      }))

      return {
        data,
        pagination: {
          cursor: data.length > 0 ? data.at(-1)!.familyId : null,
          has_more: hasMore,
        },
      }
    },
  }
}
