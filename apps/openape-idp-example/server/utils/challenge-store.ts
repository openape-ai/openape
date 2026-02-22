import { randomBytes } from 'node:crypto'
import { useAppStorage } from './storage'

interface StoredChallenge {
  challenge: string
  agentId: string
  expiresAt: number
}

export interface ChallengeStore {
  createChallenge: (agentId: string) => Promise<string>
  consumeChallenge: (challenge: string, agentId: string) => Promise<boolean>
}

export function createChallengeStore(): ChallengeStore {
  const storage = useAppStorage()

  return {
    async createChallenge(agentId) {
      const challenge = randomBytes(32).toString('hex')
      await storage.setItem<StoredChallenge>(`challenges:${challenge}`, {
        challenge,
        agentId,
        expiresAt: Date.now() + 60_000,
      })
      return challenge
    },

    async consumeChallenge(challenge, agentId) {
      const stored = await storage.getItem<StoredChallenge>(`challenges:${challenge}`)
      if (!stored)
        return false

      // Always remove (one-time use)
      await storage.removeItem(`challenges:${challenge}`)

      if (stored.expiresAt < Date.now())
        return false
      if (stored.agentId !== agentId)
        return false

      return true
    },
  }
}
