import type { GrantStore } from '@clawgate/server'
import type { ClawGateGrant, GrantStatus } from '@ddisa/core'
import { useAppStorage } from './storage'

export interface ExtendedGrantStore extends GrantStore {
  findAll(): Promise<ClawGateGrant[]>
}

export function createGrantStore(): ExtendedGrantStore {
  const storage = useAppStorage()

  return {
    async save(grant) {
      await storage.setItem(`grants:${grant.id}`, grant)
    },

    async findById(id) {
      return await storage.getItem<ClawGateGrant>(`grants:${id}`) ?? null
    },

    async updateStatus(id, status, extra?) {
      const grant = await storage.getItem<ClawGateGrant>(`grants:${id}`)
      if (!grant) throw new Error(`Grant not found: ${id}`)
      await storage.setItem(`grants:${id}`, { ...grant, status, ...extra })
    },

    async findPending() {
      const keys = await storage.getKeys('grants:')
      const results: ClawGateGrant[] = []
      for (const key of keys) {
        const grant = await storage.getItem<ClawGateGrant>(key)
        if (grant?.status === 'pending') results.push(grant)
      }
      return results.sort((a, b) => b.created_at - a.created_at)
    },

    async findByRequester(requester) {
      const keys = await storage.getKeys('grants:')
      const results: ClawGateGrant[] = []
      for (const key of keys) {
        const grant = await storage.getItem<ClawGateGrant>(key)
        if (grant?.request.requester === requester) results.push(grant)
      }
      return results.sort((a, b) => b.created_at - a.created_at)
    },

    async findAll() {
      const keys = await storage.getKeys('grants:')
      const results: ClawGateGrant[] = []
      for (const key of keys) {
        const grant = await storage.getItem<ClawGateGrant>(key)
        if (grant) results.push(grant)
      }
      return results.sort((a, b) => b.created_at - a.created_at)
    },
  }
}
