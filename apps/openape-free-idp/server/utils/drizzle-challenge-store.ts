import type { ChallengeStore, WebAuthnChallenge } from '@openape/auth'
import { eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { webauthnChallenges } from '../database/schema'

function rowToChallenge(row: typeof webauthnChallenges.$inferSelect): WebAuthnChallenge {
  return {
    challenge: row.challenge,
    userEmail: row.userEmail ?? undefined,
    type: row.type as WebAuthnChallenge['type'],
    expiresAt: row.expiresAt,
    rpId: row.rpId ?? undefined,
  }
}

export function createDrizzleChallengeStore(): ChallengeStore {
  const db = useDb()

  return {
    async save(token, challenge) {
      await db.insert(webauthnChallenges).values({
        token,
        challenge: challenge.challenge,
        userEmail: challenge.userEmail ?? null,
        type: challenge.type,
        expiresAt: challenge.expiresAt,
        rpId: challenge.rpId ?? null,
      }).onConflictDoUpdate({
        target: webauthnChallenges.token,
        set: {
          challenge: challenge.challenge,
          userEmail: challenge.userEmail ?? null,
          type: challenge.type,
          expiresAt: challenge.expiresAt,
          rpId: challenge.rpId ?? null,
        },
      })
    },

    async find(token) {
      const row = await db.select().from(webauthnChallenges).where(eq(webauthnChallenges.token, token)).get()
      if (!row) return null
      if (row.expiresAt < Date.now()) {
        await db.delete(webauthnChallenges).where(eq(webauthnChallenges.token, token))
        return null
      }
      return rowToChallenge(row)
    },

    async consume(token) {
      const row = await db.select().from(webauthnChallenges).where(eq(webauthnChallenges.token, token)).get()
      if (!row) return null
      if (row.expiresAt < Date.now()) {
        await db.delete(webauthnChallenges).where(eq(webauthnChallenges.token, token))
        return null
      }
      await db.delete(webauthnChallenges).where(eq(webauthnChallenges.token, token))
      return rowToChallenge(row)
    },
  }
}
