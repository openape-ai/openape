import type { ChallengeStore, WebAuthnChallenge } from '@openape/auth'
import { useIdpStorage } from './storage'

export function createChallengeStore(): ChallengeStore {
  const storage = useIdpStorage()

  return {
    async save(token, challenge) {
      await storage.setItem<WebAuthnChallenge>(`webauthn-challenges:${token}`, challenge)
    },

    async find(token) {
      const challenge = await storage.getItem<WebAuthnChallenge>(`webauthn-challenges:${token}`)
      if (!challenge)
        return null
      if (challenge.expiresAt < Date.now()) {
        await storage.removeItem(`webauthn-challenges:${token}`)
        return null
      }
      return challenge
    },

    async consume(token) {
      const challenge = await storage.getItem<WebAuthnChallenge>(`webauthn-challenges:${token}`)
      if (!challenge)
        return null
      if (challenge.expiresAt < Date.now()) {
        await storage.removeItem(`webauthn-challenges:${token}`)
        return null
      }
      await storage.removeItem(`webauthn-challenges:${token}`)
      return challenge
    },
  }
}
