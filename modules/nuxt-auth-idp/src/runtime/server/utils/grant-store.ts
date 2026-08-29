import type { OpenApeGrant, PaginatedResponse } from '@openape/core'
import type { GrantListParams, GrantStore } from '@openape/grants'
import { useGrantStorage } from './grant-storage'

export interface ExtendedGrantStore extends GrantStore {
  findAll: () => Promise<OpenApeGrant[]>
  findByDelegate: (delegate: string) => Promise<OpenApeGrant[]>
  findByDelegator: (delegator: string) => Promise<OpenApeGrant[]>
}

// A request never answered stops being a decision after 48h and turns into
// noise: the dev loop has long moved on, the CI poll from two days ago is over.
// Flip it to 'expired' lazily — on read, no cron. Approving through an old push
// link then fails cleanly at the status check.
const PENDING_REQUEST_TTL_S = 48 * 3600

export function createGrantStore(): ExtendedGrantStore {
  const storage = useGrantStorage()

  async function expireIfStale(grant: OpenApeGrant): Promise<OpenApeGrant> {
    const cutoff = Math.floor(Date.now() / 1000) - PENDING_REQUEST_TTL_S
    if (grant.status === 'pending' && grant.created_at < cutoff) {
      const expired = { ...grant, status: 'expired' as const }
      await storage.setItem(`grants:${grant.id}`, expired)
      return expired
    }
    return grant
  }

  async function getAllGrants(): Promise<OpenApeGrant[]> {
    const keys = await storage.getKeys('grants:')
    if (keys.length === 0) return []
    const items = await storage.getItems(keys)
    const grants = items
      .map(item => item.value as OpenApeGrant)
      .filter((grant): grant is OpenApeGrant => grant != null)
    return await Promise.all(grants.map(g => expireIfStale(g)))
  }

  return {
    async save(grant) {
      await storage.setItem(`grants:${grant.id}`, grant)
    },

    async findById(id) {
      const grant = await storage.getItem<OpenApeGrant>(`grants:${id}`)
      return grant ? await expireIfStale(grant) : null
    },

    async updateStatus(id, status, extra?) {
      const grant = await storage.getItem<OpenApeGrant>(`grants:${id}`)
      if (!grant)
        throw new Error(`Grant not found: ${id}`)
      await storage.setItem(`grants:${id}`, { ...grant, status, ...extra })
    },

    async findPending() {
      const grants = await getAllGrants()
      return grants
        .filter(g => g.status === 'pending')
        .sort((a, b) => b.created_at - a.created_at)
    },

    async findByRequester(requester) {
      const grants = await getAllGrants()
      return grants
        .filter(g => g.request.requester === requester)
        .sort((a, b) => b.created_at - a.created_at)
    },

    async findAll() {
      const grants = await getAllGrants()
      return grants.sort((a, b) => b.created_at - a.created_at)
    },

    async findByDelegate(delegate: string) {
      const grants = await getAllGrants()
      return grants
        .filter(g => g.type === 'delegation' && g.request.delegate === delegate)
        .sort((a, b) => b.created_at - a.created_at)
    },

    async findByDelegator(delegator: string) {
      const grants = await getAllGrants()
      return grants
        .filter(g => g.type === 'delegation' && g.request.delegator === delegator)
        .sort((a, b) => b.created_at - a.created_at)
    },

    async listGrants(params?: GrantListParams): Promise<PaginatedResponse<OpenApeGrant>> {
      const limit = Math.min(Math.max(params?.limit ?? 20, 1), 100)
      const cursor = params?.cursor

      const allGrants = await getAllGrants()
      let grants = allGrants.filter((grant) => {
        if (params?.status && grant.status !== params.status) return false
        if (params?.requester) {
          const requesters = Array.isArray(params.requester) ? params.requester : [params.requester]
          if (!requesters.includes(grant.request.requester)) return false
        }
        return true
      })

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
