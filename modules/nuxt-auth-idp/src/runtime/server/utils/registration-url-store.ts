import type { RegistrationUrl, RegistrationUrlStore } from '@openape/auth'
import { useIdpStorage } from './storage'

export function createRegistrationUrlStore(): RegistrationUrlStore {
  const storage = useIdpStorage()

  return {
    async save(reg) {
      await storage.setItem<RegistrationUrl>(`registration-urls:${reg.token}`, reg)
    },

    async find(token) {
      const reg = await storage.getItem<RegistrationUrl>(`registration-urls:${token}`)
      if (!reg)
        return null
      if (reg.expiresAt < Date.now() || reg.consumed)
        return null
      return reg
    },

    async consume(token) {
      const reg = await storage.getItem<RegistrationUrl>(`registration-urls:${token}`)
      if (!reg)
        return null
      if (reg.expiresAt < Date.now() || reg.consumed)
        return null
      reg.consumed = true
      await storage.setItem(`registration-urls:${token}`, reg)
      return reg
    },

    async list() {
      const keys = await storage.getKeys('registration-urls:')
      const urls: RegistrationUrl[] = []
      for (const key of keys) {
        const reg = await storage.getItem<RegistrationUrl>(key)
        if (reg)
          urls.push(reg)
      }
      return urls
    },

    async delete(token) {
      await storage.removeItem(`registration-urls:${token}`)
    },
  }
}
