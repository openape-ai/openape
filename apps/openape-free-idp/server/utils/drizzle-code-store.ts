import type { CodeEntry, CodeStore } from '@openape/auth'
import { eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { codes } from '../database/schema'

export function createDrizzleCodeStore(): CodeStore {
  const db = useDb()

  return {
    async save(entry) {
      const { code, clientId, redirectUri, codeChallenge, userId, nonce, expiresAt, ...rest } = entry
      await db.insert(codes).values({
        code,
        clientId,
        redirectUri,
        codeChallenge,
        userId,
        nonce: nonce ?? null,
        expiresAt,
        extraData: Object.keys(rest).length > 0 ? rest as Record<string, unknown> : null,
      }).onConflictDoUpdate({
        target: codes.code,
        set: {
          clientId,
          redirectUri,
          codeChallenge,
          userId,
          nonce: nonce ?? null,
          expiresAt,
          extraData: Object.keys(rest).length > 0 ? rest as Record<string, unknown> : null,
        },
      })
    },

    async find(code) {
      const row = await db.select().from(codes).where(eq(codes.code, code)).get()
      if (!row) return null

      if (row.expiresAt < Date.now()) {
        await db.delete(codes).where(eq(codes.code, code))
        return null
      }

      const extra = (row.extraData ?? {}) as Record<string, unknown>
      return {
        code: row.code,
        clientId: row.clientId,
        redirectUri: row.redirectUri,
        codeChallenge: row.codeChallenge,
        userId: row.userId,
        nonce: row.nonce ?? undefined,
        expiresAt: row.expiresAt,
        ...extra,
      } as CodeEntry
    },

    async delete(code) {
      await db.delete(codes).where(eq(codes.code, code))
    },
  }
}
