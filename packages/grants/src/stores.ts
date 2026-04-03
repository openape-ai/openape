import type { GrantStatus, OpenApeGrant, PaginatedResponse, PaginationParams } from '@openape/core'

export interface GrantListParams extends PaginationParams {
  status?: GrantStatus
  requester?: string
  role?: string
}

export interface GrantStore {
  save: (grant: OpenApeGrant) => Promise<void>
  findById: (id: string) => Promise<OpenApeGrant | null>
  updateStatus: (id: string, status: GrantStatus, extra?: Partial<OpenApeGrant>) => Promise<void>
  findPending: () => Promise<OpenApeGrant[]>
  findByRequester: (requester: string) => Promise<OpenApeGrant[]>
  findByDelegate?: (delegate: string) => Promise<OpenApeGrant[]>
  findByDelegator?: (delegator: string) => Promise<OpenApeGrant[]>
  listGrants: (params?: GrantListParams) => Promise<PaginatedResponse<OpenApeGrant>>
}

export class InMemoryGrantStore implements GrantStore {
  private grants = new Map<string, OpenApeGrant>()

  async save(grant: OpenApeGrant): Promise<void> {
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
    this.grants.set(id, { ...grant, status, ...extra })
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
    if (params?.requester) {
      grants = grants.filter(g => g.request.requester === params.requester)
    }

    // Sort by created_at DESC
    grants.sort((a, b) => b.created_at - a.created_at)

    // Apply cursor (skip grants until created_at < cursor)
    if (cursor) {
      const cursorTs = Number(cursor)
      const idx = grants.findIndex(g => g.created_at < cursorTs)
      grants = idx >= 0 ? grants.slice(idx) : []
    }

    const page = grants.slice(0, limit)
    const hasMore = grants.length > limit

    return {
      data: page.map(g => ({ ...g })),
      pagination: {
        cursor: page.length > 0 ? String(page.at(-1)!.created_at) : null,
        has_more: hasMore,
      },
    }
  }
}
