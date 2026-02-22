import type { OpenApeGrant } from '@ddisa/core'
import type { GrantStore } from '@openape/grants'
import { useAppStorage } from './storage'

export interface ExtendedGrantStore extends GrantStore {
  findAll: () => Promise<OpenApeGrant[]>
}

export function createGrantStore(): ExtendedGrantStore {
  const storage = useAppStorage()

  return {
    async save(grant) {
      await storage.setItem(`grants:${grant.id}`, grant)
    },

    async findById(id) {
      return await storage.getItem<OpenApeGrant>(`grants:${id}`) ?? null
    },

    async updateStatus(id, status, extra?) {
      const grant = await storage.getItem<OpenApeGrant>(`grants:${id}`)
      if (!grant)
        throw new Error(`Grant not found: ${id}`)
      await storage.setItem(`grants:${id}`, { ...grant, status, ...extra })
    },

    async findPending() {
      const keys = await storage.getKeys('grants:')
      const results: OpenApeGrant[] = []
      for (const key of keys) {
        const grant = await storage.getItem<OpenApeGrant>(key)
        if (grant?.status === 'pending')
          results.push(grant)
      }
      return results.sort((a, b) => b.created_at - a.created_at)
    },

    async findByRequester(requester) {
      const keys = await storage.getKeys('grants:')
      const results: OpenApeGrant[] = []
      for (const key of keys) {
        const grant = await storage.getItem<OpenApeGrant>(key)
        if (grant?.request.requester === requester)
          results.push(grant)
      }
      return results.sort((a, b) => b.created_at - a.created_at)
    },

    async findAll() {
      const keys = await storage.getKeys('grants:')
      const results: OpenApeGrant[] = []
      for (const key of keys) {
        const grant = await storage.getItem<OpenApeGrant>(key)
        if (grant)
          results.push(grant)
      }
      return results.sort((a, b) => b.created_at - a.created_at)
    },
  }
}
