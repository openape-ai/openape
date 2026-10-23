import { grantCursor, parseGrantCursor } from './grant-cursor.js'
import { assertGrantReferenceRequest, assertSameReferencedGrant, grantReferenceKey } from './grant-reference.js'
import type { GrantStatus, OpenApeGrant, PaginatedResponse, PaginationParams } from '@openape/core'

export interface GrantListParams extends PaginationParams {
  brokerOwner?: string | null
  requesterFilter?: string
  /** Filter by request.batch.id (grants.md §4.2). */
  batch?: string
  reference?: string
  referenceKey?: string
  status?: GrantStatus
  excludeStatus?: GrantStatus
  requester?: string | string[]
  role?: string
}

export interface GrantStore {
  /** Atomic insert-or-return; must retain terminal references and reject changed bindings. */
  createReferenced?: (grant: OpenApeGrant) => Promise<{ grant: OpenApeGrant, created: boolean }>
  save: (grant: OpenApeGrant) => Promise<void>
  findById: (id: string) => Promise<OpenApeGrant | null>
  updateStatus: (id: string, status: GrantStatus, extra?: Partial<OpenApeGrant>) => Promise<void>
  findPending: () => Promise<OpenApeGrant[]>
  findByRequester: (requester: string) => Promise<OpenApeGrant[]>
  findByDelegate?: (delegate: string) => Promise<OpenApeGrant[]>
  findByDelegator?: (delegator: string) => Promise<OpenApeGrant[]>
  listGrants: (params?: GrantListParams) => Promise<PaginatedResponse<OpenApeGrant>>
  /**
   * Marks an approved grant `used` in one step and returns true, or returns
   * false when it is no longer approved, so a single-use grant is spent once.
   */
  claimOnce?: (id: string, usedAt: number) => Promise<boolean>
  /**
   * Records the one redemption (`/consume`) of a single-use grant spent by
   * its command token: true for the first call only, whatever the `jti`.
   */
  markConsumed?: (id: string, jti: string) => Promise<boolean>
  /**
   * Marks a pending grant, or an approved single-use grant whose token was
   * not issued yet, `withdrawn` in one step (grants.md §4.11) and returns the
   * status it replaced; null when it is in any other state.
   */
  withdraw?: (id: string, withdrawnAt: number, reason?: string) => Promise<'pending' | 'approved' | null>
}

export class InMemoryGrantStore implements GrantStore {
  private grants = new Map<string, OpenApeGrant>()
  private consumed = new Map<string, string>()

  async createReferenced(grant: OpenApeGrant): Promise<{ grant: OpenApeGrant, created: boolean }> {
    assertGrantReferenceRequest(grant.request)
    if (!grant.request.reference) throw new Error('A reference is required')
    const key = grantReferenceKey(grant.request.requester, grant.request.reference, grant.brokered)
    const existing = [...this.grants.values()].find(item => item.request.reference !== undefined && grantReferenceKey(item.request.requester, item.request.reference, item.brokered) === key)
    if (existing) {
      assertSameReferencedGrant(existing, grant)
      return { grant: structuredClone(existing), created: false }
    }
    this.grants.set(grant.id, structuredClone(grant))
    return { grant: structuredClone(grant), created: true }
  }

  async save(grant: OpenApeGrant): Promise<void> {
    if (grant.request.reference !== undefined) throw new Error('Use atomic createReferenced for a referenced grant')
    this.grants.set(grant.id, { ...grant })
  }

  async findById(id: string): Promise<OpenApeGrant | null> {
    const grant = this.grants.get(id)
    return grant ? { ...grant } : null
  }

  async updateStatus(
    id: string,
    status: GrantStatus,
    extra?: Partial<OpenApeGrant>,
  ): Promise<void> {
    const grant = this.grants.get(id)
    if (!grant) {
      throw new Error(`Grant not found: ${id}`)
    }
    if (grant.request.reference && extra?.request) assertSameReferencedGrant(grant, { ...grant, request: extra.request })
    this.grants.set(id, { ...grant, status, ...extra })
  }

  async claimOnce(id: string, usedAt: number): Promise<boolean> {
    const grant = this.grants.get(id)
    if (grant?.status !== 'approved') return false
    this.grants.set(id, { ...grant, status: 'used', used_at: usedAt })
    return true
  }

  async withdraw(id: string, withdrawnAt: number, reason?: string): Promise<'pending' | 'approved' | null> {
    const grant = this.grants.get(id)
    if (!grant || !(grant.status === 'pending' || (grant.status === 'approved' && grant.request.grant_type === 'once'))) return null
    this.grants.set(id, { ...grant, status: 'withdrawn', decided_at: withdrawnAt, ...(reason !== undefined ? { withdraw_reason: reason } : {}) })
    return grant.status
  }

  async markConsumed(id: string, jti: string): Promise<boolean> {
    if (!this.grants.has(id) || this.consumed.has(id)) return false
    this.consumed.set(id, jti)
    return true
  }

  async findPending(): Promise<OpenApeGrant[]> {
    const results: OpenApeGrant[] = []
    for (const grant of this.grants.values()) {
      if (grant.status === 'pending') {
        results.push({ ...grant })
      }
    }
    return results
  }

  async findByRequester(requester: string): Promise<OpenApeGrant[]> {
    const results: OpenApeGrant[] = []
    for (const grant of this.grants.values()) {
      if (grant.request.requester === requester) {
        results.push({ ...grant })
      }
    }
    return results
  }

  async findByDelegate(delegate: string): Promise<OpenApeGrant[]> {
    const results: OpenApeGrant[] = []
    for (const grant of this.grants.values()) {
      if (grant.type === 'delegation' && grant.request.delegate === delegate) {
        results.push({ ...grant })
      }
    }
    return results
  }

  async findByDelegator(delegator: string): Promise<OpenApeGrant[]> {
    const results: OpenApeGrant[] = []
    for (const grant of this.grants.values()) {
      if (grant.type === 'delegation' && grant.request.delegator === delegator) {
        results.push({ ...grant })
      }
    }
    return results
  }

  async listGrants(params?: GrantListParams): Promise<PaginatedResponse<OpenApeGrant>> {
    const limit = Math.min(Math.max(params?.limit ?? 20, 1), 100)
    const cursor = params?.cursor

    let grants = [...this.grants.values()]

    // Filter
    if (params?.status) {
      grants = grants.filter(g => g.status === params.status)
    }
    if (params?.excludeStatus) grants = grants.filter(g => g.status !== params.excludeStatus)
    if (params?.requester) {
      const requesters = Array.isArray(params.requester) ? new Set(params.requester) : new Set([params.requester])
      grants = grants.filter(g => params.brokerOwner !== undefined ? (g.brokered ? g.brokered.owner === params.brokerOwner : requesters.has(g.request.requester)) : requesters.has(g.request.requester))
    }

    if (params?.requesterFilter) grants = grants.filter(g => g.request.requester === params.requesterFilter)
    if (params?.batch) grants = grants.filter(g => g.request.batch?.id === params.batch)

    if (params?.reference) grants = grants.filter(g => g.request.reference === params.reference)
    if (params?.referenceKey) grants = grants.filter(g => g.request.reference !== undefined && grantReferenceKey(g.request.requester, g.request.reference, g.brokered) === params.referenceKey)

    // Sort by created_at DESC
    grants.sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))

    // Apply cursor (skip grants until created_at < cursor)
    if (cursor) {
      const position = parseGrantCursor(cursor)
      grants = grants.filter(g => g.created_at < position.createdAt || (position.id !== undefined && g.created_at === position.createdAt && g.id < position.id))
    }

    const page = grants.slice(0, limit)
    const hasMore = grants.length > limit

    return {
      data: page.map(g => ({ ...g })),
      pagination: {
        cursor: page.length > 0 ? grantCursor(page.at(-1)!) : null,
        has_more: hasMore,
      },
    }
  }
}
