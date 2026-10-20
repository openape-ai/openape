import type { OpenApeGrant, PaginatedResponse } from '@openape/core'
import type { GrantListParams, GrantStore } from '@openape/grants'
import { grantCursor, parseGrantCursor, grantReferenceKey } from '@openape/grants'
import { useGrantStorage } from './grant-storage'

export interface ExtendedGrantStore extends GrantStore {
  findAll: () => Promise<OpenApeGrant[]>
  findByDelegate: (delegate: string) => Promise<OpenApeGrant[]>
  findByDelegator: (delegator: string) => Promise<OpenApeGrant[]>
  claimOnce: NonNullable<GrantStore['claimOnce']>
  markConsumed: NonNullable<GrantStore['markConsumed']>
}

// A request never answered stops being a decision after 48h and turns into
// noise: the dev loop has long moved on, the CI poll from two days ago is over.
// Flip it to 'expired' lazily — on read, no cron. Approving through an old push
// link then fails cleanly at the status check.
const PENDING_REQUEST_TTL_S = 48 * 3600

let claims: Promise<unknown> = Promise.resolve()

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
      if (grant.request.reference !== undefined) throw new Error('Grant references require an atomic store')
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

    // Claims run one after another; the unstorage fallback serves a single process,
    // production stores claim in one conditional database statement.
    async claimOnce(id, usedAt) {
      const claim = claims.then(async () => {
        const grant = await storage.getItem<OpenApeGrant>(`grants:${id}`)
        if (grant?.status !== 'approved') return false
        await storage.setItem(`grants:${id}`, { ...grant, status: 'used', used_at: usedAt })
        return true
      })
      claims = claim.catch(() => false)
      return await claim
    },

    async markConsumed(id, jti) {
      const mark = claims.then(async () => {
        if (!await storage.hasItem(`grants:${id}`) || await storage.hasItem(`grants-consumed:${id}`)) return false
        await storage.setItem(`grants-consumed:${id}`, jti)
        return true
      })
      claims = mark.catch(() => false)
      return await mark
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
        if (params?.excludeStatus && grant.status === params.excludeStatus) return false
        if (params?.reference && grant.request.reference !== params.reference) return false
        if (params?.referenceKey && (grant.request.reference === undefined || grantReferenceKey(grant.request.requester, grant.request.reference, grant.brokered) !== params.referenceKey)) return false
        if (params?.status && grant.status !== params.status) return false
        if (params?.requester) {
          const requesters = Array.isArray(params.requester) ? params.requester : [params.requester]
          if (params.brokerOwner !== undefined ? (grant.brokered ? grant.brokered.owner !== params.brokerOwner : !requesters.includes(grant.request.requester)) : !requesters.includes(grant.request.requester)) return false
        }
        if (params?.requesterFilter && grant.request.requester !== params.requesterFilter) return false
        if (params?.batch && grant.request.batch?.id !== params.batch) return false
        return true
      })

      grants.sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))

      if (cursor) {
        const position = parseGrantCursor(cursor)
        grants = grants.filter(g => g.created_at < position.createdAt || (position.id !== undefined && g.created_at === position.createdAt && g.id < position.id))
      }

      const page = grants.slice(0, limit)
      const hasMore = grants.length > limit

      return {
        data: page,
        pagination: {
          cursor: page.length > 0 ? grantCursor(page.at(-1)!) : null,
          has_more: hasMore,
        },
      }
    },
  }
}
