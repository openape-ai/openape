import type { OpenApeGrant, PaginatedResponse } from '@openape/core'
import type { GrantListParams, GrantStore } from '@openape/grants'
import { useGrantStorage } from './grant-storage'

export interface ExtendedGrantStore extends GrantStore {
  findAll: () => Promise<OpenApeGrant[]>
  findByDelegate: (delegate: string) => Promise<OpenApeGrant[]>
  findByDelegator: (delegator: string) => Promise<OpenApeGrant[]>
}

export function createGrantStore(): ExtendedGrantStore {
  const storage = useGrantStorage()

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

    async findByDelegate(delegate: string) {
      const keys = await storage.getKeys('grants:')
      const results: OpenApeGrant[] = []
      for (const key of keys) {
        const grant = await storage.getItem<OpenApeGrant>(key)
        if (grant?.type === 'delegation' && grant.request.delegate === delegate)
          results.push(grant)
      }
      return results.sort((a, b) => b.created_at - a.created_at)
    },

    async findByDelegator(delegator: string) {
      const keys = await storage.getKeys('grants:')
      const results: OpenApeGrant[] = []
      for (const key of keys) {
        const grant = await storage.getItem<OpenApeGrant>(key)
        if (grant?.type === 'delegation' && grant.request.delegator === delegator)
          results.push(grant)
      }
      return results.sort((a, b) => b.created_at - a.created_at)
    },

    async listGrants(params?: GrantListParams): Promise<PaginatedResponse<OpenApeGrant>> {
      const limit = Math.min(Math.max(params?.limit ?? 20, 1), 100)
      const cursor = params?.cursor

      const keys = await storage.getKeys('grants:')
      let grants: OpenApeGrant[] = []
      for (const key of keys) {
        const grant = await storage.getItem<OpenApeGrant>(key)
        if (!grant) continue
        if (params?.status && grant.status !== params.status) continue
        if (params?.requester && grant.request.requester !== params.requester) continue
        grants.push(grant)
      }

      grants.sort((a, b) => b.created_at - a.created_at)

      if (cursor) {
        const cursorTs = Number(cursor)
        const idx = grants.findIndex(g => g.created_at < cursorTs)
        grants = idx >= 0 ? grants.slice(idx) : []
      }

      const page = grants.slice(0, limit)
      const hasMore = grants.length > limit

      return {
        data: page,
        pagination: {
          cursor: page.length > 0 ? String(page.at(-1)!.created_at) : null,
          has_more: hasMore,
        },
      }
    },
  }
}
