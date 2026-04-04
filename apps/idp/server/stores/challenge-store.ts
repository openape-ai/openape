import { randomBytes } from 'node:crypto'
import type { GrantChallengeStore } from '@openape/auth'
import { eq } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { grantChallenges } from '../database/schema'
import type * as schema from '../database/schema'

export function createDrizzleChallengeStore(db: LibSQLDatabase<typeof schema>): GrantChallengeStore {
  return {
    async createChallenge(entityId) {
      const challenge = randomBytes(32).toString('hex')
      await db.insert(grantChallenges).values({
        challenge,
        agentId: entityId,
        expiresAt: Date.now() + 60_000,
      })
      return challenge
    },

    async consumeChallenge(challenge, entityId) {
      const row = await db.select().from(grantChallenges).where(eq(grantChallenges.challenge, challenge)).get()

      if (!row) return false

      await db.delete(grantChallenges).where(eq(grantChallenges.challenge, challenge))

      if (row.expiresAt < Date.now()) return false
      if (row.agentId !== entityId) return false

      return true
    },
  }
}
