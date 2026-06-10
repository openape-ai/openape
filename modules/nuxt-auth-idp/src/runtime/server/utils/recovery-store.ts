import type { RecoveryStore, RecoveryToken } from '@openape/auth'
import { useIdpStorage } from './storage'

const PREFIX = 'recovery-tokens:'

export function createRecoveryStore(): RecoveryStore {
  const storage = useIdpStorage()

  return {
    async save(token) {
      await storage.setItem<RecoveryToken>(`${PREFIX}${token.token}`, token)
    },

    async find(token) {
      const entry = await storage.getItem<RecoveryToken>(`${PREFIX}${token}`)
      if (!entry) return null
      if (entry.cancelled || entry.consumed) return null
      if (entry.expiresAt < Date.now()) return null
      return entry
    },

    async listActiveForEmail(email) {
      const keys = await storage.getKeys(PREFIX)
      const now = Date.now()
      const out: RecoveryToken[] = []
      for (const key of keys) {
        const entry = await storage.getItem<RecoveryToken>(key)
        if (!entry) continue
        if (entry.email !== email) continue
        if (entry.cancelled || entry.consumed) continue
        if (entry.expiresAt < now) continue
        out.push(entry)
      }
      return out
    },

    async listAllForEmail(email) {
      const keys = await storage.getKeys(PREFIX)
      const out: RecoveryToken[] = []
      for (const key of keys) {
        const entry = await storage.getItem<RecoveryToken>(key)
        if (!entry) continue
        if (entry.email !== email) continue
        out.push(entry)
      }
      return out
    },

    async markConsumed(token) {
      const entry = await storage.getItem<RecoveryToken>(`${PREFIX}${token}`)
      if (!entry) return
      entry.consumed = true
      await storage.setItem(`${PREFIX}${token}`, entry)
    },

    async cancelAllForEmail(email, reason) {
      const keys = await storage.getKeys(PREFIX)
      const now = Date.now()
      let count = 0
      for (const key of keys) {
        const entry = await storage.getItem<RecoveryToken>(key)
        if (!entry) continue
        if (entry.email !== email || entry.cancelled || entry.consumed) continue
        if (entry.expiresAt < now) continue
        entry.cancelled = true
        entry.cancelledAt = now
        entry.cancelledReason = reason
        await storage.setItem(key, entry)
        count++
      }
      return count
    },
  }
}
