import type { JtiStore } from '@openape/auth'
import { useIdpStorage } from './storage'

export function createJtiStore(): JtiStore {
  const storage = useIdpStorage()

  return {
    async hasBeenUsed(jti: string): Promise<boolean> {
      const stored = await storage.getItem<{ expiresAt: number }>(`jti:${jti}`)
      if (!stored) return false
      if (stored.expiresAt < Date.now()) {
        await storage.removeItem(`jti:${jti}`)
        return false
      }
      return true
    },

    async markUsed(jti: string, ttlMs: number): Promise<void> {
      await storage.setItem(`jti:${jti}`, {
        expiresAt: Date.now() + ttlMs,
      })
    },
  }
}
