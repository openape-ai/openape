import type { EmailHistoryStore } from '@openape/auth'
import { useIdpStorage } from './storage'

const PREFIX = 'email-history:'

export function createEmailHistoryStore(): EmailHistoryStore {
  const storage = useIdpStorage()

  return {
    async record(accountEmail, address) {
      const key = `${PREFIX}${accountEmail}`
      const list = (await storage.getItem<string[]>(key)) ?? []
      if (!list.includes(address)) {
        list.push(address)
        await storage.setItem(key, list)
      }
    },

    async listAllForEmail(email) {
      const list = (await storage.getItem<string[]>(`${PREFIX}${email}`)) ?? []
      return list.includes(email) ? list : [email, ...list]
    },
  }
}
