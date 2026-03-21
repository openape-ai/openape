import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { grantChallenges } from '../database/schema'

export interface GrantChallengeStore {
  createChallenge: (agentId: string) => Promise<string>
  consumeChallenge: (challenge: string, agentId: string) => Promise<boolean>
}

export function createDrizzleGrantChallengeStore(): GrantChallengeStore {
  const db = useDb()

  return {
    async createChallenge(agentId) {
      const challenge = randomBytes(32).toString('hex')
      await db.insert(grantChallenges).values({
        challenge,
        agentId,
        expiresAt: Date.now() + 60_000,
      })
      return challenge
    },

    async consumeChallenge(challenge, agentId) {
      const row = await db.select().from(grantChallenges).where(eq(grantChallenges.challenge, challenge)).get()

      if (!row)
        return false

      await db.delete(grantChallenges).where(eq(grantChallenges.challenge, challenge))

      if (row.expiresAt < Date.now())
        return false
      if (row.agentId !== agentId)
        return false

      return true
    },
  }
}
