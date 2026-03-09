import type { GrantStatus, OpenApeGrant } from '@openape/core'

export interface GrantStore {
  save: (grant: OpenApeGrant) => Promise<void>
  findById: (id: string) => Promise<OpenApeGrant | null>
  updateStatus: (id: string, status: GrantStatus, extra?: Partial<OpenApeGrant>) => Promise<void>
  findPending: () => Promise<OpenApeGrant[]>
  findByRequester: (requester: string) => Promise<OpenApeGrant[]>
  findByDelegate?: (delegate: string) => Promise<OpenApeGrant[]>
  findByDelegator?: (delegator: string) => Promise<OpenApeGrant[]>
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
}
