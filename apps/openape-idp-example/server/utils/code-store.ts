import type { CodeEntry, CodeStore } from '@openape/auth'
import { useAppStorage } from './storage'

export function createCodeStore(): CodeStore {
  const storage = useAppStorage()

  return {
    async save(entry) {
      await storage.setItem(`codes:${entry.code}`, entry)
    },

    async find(code) {
      const entry = await storage.getItem<CodeEntry>(`codes:${code}`)
      if (!entry)
        return null

      if (entry.expiresAt < Date.now()) {
        await storage.removeItem(`codes:${code}`)
        return null
      }

      return entry
    },

    async delete(code) {
      await storage.removeItem(`codes:${code}`)
    },
  }
}
