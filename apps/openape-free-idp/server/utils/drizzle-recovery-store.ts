import type { RecoveryStore, RecoveryToken } from '@openape/auth'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { recoveryTokens } from '../database/schema'

type RecoveryTokenRow = typeof recoveryTokens.$inferSelect

function rowToToken(row: RecoveryTokenRow): RecoveryToken {
  return {
    token: row.token,
    email: row.email,
    createdAt: row.createdAt,
    usableAt: row.usableAt,
    expiresAt: row.expiresAt,
    cancelled: row.cancelled,
    cancelledAt: row.cancelledAt ?? undefined,
    cancelledReason: row.cancelledReason ?? undefined,
    consumed: row.consumed,
    requestIp: row.requestIp ?? undefined,
    requestUserAgent: row.requestUserAgent ?? undefined,
  }
}

export function createDrizzleRecoveryStore(): RecoveryStore {
  const db = useDb()

  return {
    async save(token) {
      await db.insert(recoveryTokens).values({
        token: token.token,
        email: token.email,
        createdAt: token.createdAt,
        usableAt: token.usableAt,
        expiresAt: token.expiresAt,
        cancelled: token.cancelled,
        cancelledAt: token.cancelledAt ?? null,
        cancelledReason: token.cancelledReason ?? null,
        consumed: token.consumed,
        requestIp: token.requestIp ?? null,
        requestUserAgent: token.requestUserAgent ?? null,
      }).onConflictDoUpdate({
        target: recoveryTokens.token,
        set: {
          cancelled: token.cancelled,
          cancelledAt: token.cancelledAt ?? null,
          cancelledReason: token.cancelledReason ?? null,
          consumed: token.consumed,
        },
      })
    },

    async find(token) {
      const row = await db.select().from(recoveryTokens).where(eq(recoveryTokens.token, token)).get()
      if (!row) return null
      if (row.cancelled || row.consumed) return null
      if (row.expiresAt < Date.now()) return null
      return rowToToken(row)
    },

    async listActiveForEmail(email) {
      const now = Date.now()
      const rows = await db.select().from(recoveryTokens).where(eq(recoveryTokens.email, email)).all()
      return rows
        .filter(r => !r.cancelled && !r.consumed && r.expiresAt >= now)
        .map(rowToToken)
    },

    async markConsumed(token) {
      await db.update(recoveryTokens).set({ consumed: true }).where(eq(recoveryTokens.token, token))
    },

    async cancelAllForEmail(email, reason) {
      const now = Date.now()
      const rows = await db.select().from(recoveryTokens).where(and(
        eq(recoveryTokens.email, email),
        eq(recoveryTokens.cancelled, false),
        eq(recoveryTokens.consumed, false),
      )).all()
      const active = rows.filter(r => r.expiresAt >= now)
      if (active.length === 0) return 0
      await db.update(recoveryTokens)
        .set({ cancelled: true, cancelledAt: now, cancelledReason: reason })
        .where(and(
          eq(recoveryTokens.email, email),
          eq(recoveryTokens.cancelled, false),
          eq(recoveryTokens.consumed, false),
        ))
      return active.length
    },
  }
}
